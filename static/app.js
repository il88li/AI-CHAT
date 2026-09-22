"""
خَيال — منصة البرومبتات العربية
Flask + PostgreSQL + تسجيل دخول محلي + استقرار إنتاجي
v14.2 — Security + Notifications + Reports + Pagination + User Search
- CSRF protection على كل POST/PATCH/DELETE
- Rate limiting على auth endpoints
- SECRET_KEY صارم في الإنتاج
- URL validation على avatar/image/website
- نظام إشعارات كامل (auto-create on like/comment/follow/message)
- Reports endpoints
- Post edit endpoint
- Pagination على user posts / followers / following
- User search endpoint (/api/users/search)
"""
import os
import re
import sys
import time
import json
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, render_template, jsonify, request, session,
                   abort, redirect, url_for, make_response, send_from_directory,
                   g)
from flask_compress import Compress
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import inspect, text, func
from sqlalchemy.orm import joinedload
from dotenv import load_dotenv

from database import (db, build_database_uri, test_connection,
                      User, Post, Comment, Like, Save, Follow, Chat, Message,
                      Notification, Report,
                      ALLOWED_COVERS, ALLOWED_FRAMES,
                      ALLOWED_PRONOUNS, ALLOWED_CARD_STYLES,
                      ALLOWED_REPORT_REASONS)

load_dotenv()


# ═══════════════════════════════════════════════════════════
# إعداد التطبيق
# ═══════════════════════════════════════════════════════════
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

_IS_PROD = os.getenv("FLASK_ENV") == "production" or bool(os.getenv("RENDER"))

# ─── الأمان ───
_secret = os.getenv("SECRET_KEY")
if not _secret:
    if _IS_PROD:
        raise RuntimeError(
            "❌ SECRET_KEY غير معرّف في متغيرات البيئة. "
            "لا يمكن تشغيل التطبيق في الإنتاج بدون مفتاح ثابت — "
            "الجلسات ستُبطَل عند كل إعادة تشغيل."
        )
    _secret = secrets.token_hex(32)
    print("⚠️  SECRET_KEY مؤقت للتطوير — لن يبقى بين إعادات التشغيل",
          file=sys.stderr)

app.config["SECRET_KEY"] = _secret
app.config["SESSION_COOKIE_SECURE"] = _IS_PROD
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2MB max body

# ─── قاعدة البيانات ───
app.config["SQLALCHEMY_DATABASE_URI"] = build_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

_engine_opts = {
    "pool_pre_ping": True,
    "pool_recycle": 120,
    "pool_use_lifo": True,
    "pool_timeout": 30,
    "connect_args": {
        "connect_timeout": 15,
        "keepalives": 1,
        "keepalives_idle": 20,
        "keepalives_interval": 10,
        "keepalives_count": 5,
        "application_name": "khayal",
    },
}
if _IS_PROD:
    _engine_opts["pool_size"] = 3
    _engine_opts["max_overflow"] = 2
else:
    _engine_opts["pool_size"] = 2
    _engine_opts["max_overflow"] = 1

app.config["SQLALCHEMY_ENGINE_OPTIONS"] = _engine_opts

# ─── ضغط ───
app.config["COMPRESS_MIMETYPES"] = [
    "text/html", "text/css", "text/javascript",
    "application/json", "application/javascript", "image/svg+xml",
]
app.config["COMPRESS_LEVEL"] = 6
app.config["COMPRESS_MIN_SIZE"] = 500
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = timedelta(days=30)

db.init_app(app)
Compress(app)


# ═══════════════════════════════════════════════════════════
# Helpers — مصادقة + تحقق
# ═══════════════════════════════════════════════════════════
def current_user():
    if hasattr(g, "_cached_user"):
        return g._cached_user
    uid = session.get("user_id")
    user = db.session.get(User, uid) if uid else None
    g._cached_user = user
    return user


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return jsonify({"error": "يجب تسجيل الدخول"}), 401
        g.user = u
        return fn(*a, **kw)
    return wrapper


def _validate_url(s, max_len=1024):
    """Allow only http/https URLs. Reject javascript:/data:/etc."""
    if not s:
        return True
    if not isinstance(s, str):
        return False
    if len(s) > max_len:
        return False
    return bool(re.match(r"^https?://[^\s<>\"']+$", s.strip(), re.IGNORECASE))


def _validate_username(s):
    return bool(re.match(r"^[a-zA-Z0-9_\-]{3,32}$", s or ""))


def _validate_email(s):
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s or ""))


def _validate_password(s):
    return isinstance(s, str) and len(s) >= 6


def _is_local_mode():
    return not _IS_PROD


def _payload(u):
    """Serializes the current user for page render + auth endpoints."""
    if not u:
        return None
    d = u.to_dict()
    d["email"] = u.email
    try:
        d["posts_count"] = u.posts.count()
        totals = db.session.query(
            func.coalesce(func.sum(Post.likes), 0),
            func.coalesce(func.sum(Post.copies), 0),
        ).filter(Post.author_id == u.id).first()
        if totals:
            d["total_likes"] = int(totals[0])
            d["total_copies"] = int(totals[1])
        else:
            d["total_likes"] = 0
            d["total_copies"] = 0
    except Exception:
        d["posts_count"] = 0
        d["total_likes"] = 0
        d["total_copies"] = 0
    return d


# ═══════════════════════════════════════════════════════════
# CSRF
# ═══════════════════════════════════════════════════════════
_CSRF_EXEMPT = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/health",
    "/api/db-test",
}

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _get_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


@app.context_processor
def _inject_csrf():
    return {"csrf_token": _get_csrf_token}


@app.before_request
def _csrf_protect():
    if request.method in _SAFE_METHODS:
        return
    if not request.path.startswith("/api/"):
        return
    if request.path in _CSRF_EXEMPT:
        return

    expected = session.get("csrf_token")
    provided = (request.headers.get("X-CSRF-Token")
                or request.headers.get("X-CSRFToken"))
    if not expected or not provided or not secrets.compare_digest(expected, provided):
        return jsonify({"error": "CSRF token مفقود أو غير صالح"}), 403


# ═══════════════════════════════════════════════════════════
# Rate Limiting (in-memory, per-process)
# ═══════════════════════════════════════════════════════════
_RATE_BUCKETS: dict = {}


def _rate_limit(key: str, max_hits: int, window_s: int) -> bool:
    now = time.time()
    bucket = _RATE_BUCKETS.get(key) or []
    bucket = [t for t in bucket if now - t < window_s]
    if len(bucket) >= max_hits:
        _RATE_BUCKETS[key] = bucket
        return False
    bucket.append(now)
    _RATE_BUCKETS[key] = bucket
    return True


def _client_ip() -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "0.0.0.0"


def rate_limit(max_hits: int, window_s: int, scope: str):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            key = f"{scope}:{_client_ip()}"
            if not _rate_limit(key, max_hits, window_s):
                return jsonify({
                    "error": f"محاولات كثيرة، حاول بعد {window_s} ثانية"
                }), 429
            return fn(*a, **kw)
        return wrapper
    return deco


# ═══════════════════════════════════════════════════════════
# Notifications helper
# ═══════════════════════════════════════════════════════════
def _notify(user_id, actor_id, kind, target_type=None,
            target_id=None, text=None):
    """Create a notification unless disabled by user preferences or self-action."""
    if not user_id or not actor_id:
        return None
    if user_id == actor_id:
        return None

    try:
        target = db.session.get(User, user_id)
        if target:
            prefs = target.to_dict().get("preferences") or {}
            notif_prefs = prefs.get("notif") or {}
            kind_to_pref = {
                "like": "likes",
                "comment": "comments",
                "follow": "follows",
                "message": "messages",
            }
            pref_key = kind_to_pref.get(kind)
            if pref_key and notif_prefs.get(pref_key) is False:
                return None
    except Exception:
        pass

    n = Notification(
        user_id=user_id,
        actor_id=actor_id,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        text=(text or "")[:255],
    )
    db.session.add(n)
    return n


# ═══════════════════════════════════════════════════════════
# Middleware
# ═══════════════════════════════════════════════════════════
@app.before_request
def _before_request():
    if request.path.startswith("/api/"):
        g.request_start = time.time()
    _get_csrf_token()


@app.after_request
def _after_request(response):
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
    elif request.path.startswith("/api/"):
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-cache, must-revalidate"

    try:
        start = getattr(g, "request_start", None)
        if start:
            elapsed = (time.time() - start) * 1000
            if elapsed > 1000:
                print(f"⚠️ طلب بطيء: {request.method} {request.path} — {elapsed:.0f}ms",
                      file=sys.stderr)
    except Exception:
        pass

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    if _IS_PROD:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response


# ═══════════════════════════════════════════════════════════
# الصفحات
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    return render_template("index.html", me=_payload(current_user()))


@app.route("/app")
def app_view():
    return render_template("index.html", me=_payload(current_user()))


@app.route("/u/<username>")
def public_profile(username):
    return render_template("index.html", me=_payload(current_user()))


@app.route("/offline")
def offline():
    return render_template("error.html", code=503,
                           title="لا يوجد اتصال",
                           message="يبدو أنك غير متصل بالإنترنت.")


@app.route("/privacy")
def privacy():
    return render_template("privacy.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json",
                               mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    r = make_response(send_from_directory("static", "sw.js",
                                          mimetype="application/javascript"))
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Service-Worker-Allowed"] = "/"
    return r


# ═══════════════════════════════════════════════════════════
# المصادقة
# ═══════════════════════════════════════════════════════════
@app.post("/api/auth/register")
@rate_limit(max_hits=5, window_s=3600, scope="register")
def api_register():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    username = (data.get("username") or "").strip()
    name = (data.get("name") or "").strip()
    password = data.get("password") or ""

    if not email or not username or not name or not password:
        return jsonify({"error": "جميع الحقول مطلوبة"}), 400
    if not _validate_email(email):
        return jsonify({"error": "البريد الإلكتروني غير صحيح"}), 400
    if not _validate_username(username):
        return jsonify({"error": "اسم المستخدم غير صحيح (3-32 حرفاً إنجليزي)"}), 400
    if len(name) < 2:
        return jsonify({"error": "الاسم قصير جداً"}), 400
    if not _validate_password(password):
        return jsonify({"error": "كلمة المرور يجب أن تكون 6 أحرف على الأقل"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "البريد الإلكتروني مستخدم"}), 409
    if User.query.filter_by(username=username.lower()).first():
        return jsonify({"error": "اسم المستخدم مستخدم"}), 409

    handle = "@" + username.lower()
    if User.query.filter_by(handle=handle).first():
        return jsonify({"error": "اسم المستخدم مستخدم"}), 409

    try:
        user = User(
            email=email,
            username=username.lower(),
            name=name,
            handle=handle,
            password_hash=generate_password_hash(
                password, method="pbkdf2:sha256", salt_length=16
            ),
            avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={name}&backgroundColor=22D3EE,8B5CF6",
            bio="",
            verified=False,
            cover="aurora",
            accent_color="#22D3EE",
            avatar_shape="ring",
            card_style="glass",
            preferences="{}",
        )
        db.session.add(user)
        db.session.commit()
        print(f"✅ مستخدم جديد: {user.username}")

        session.permanent = True
        session["user_id"] = user.id
        _get_csrf_token()
        return jsonify(_payload(user)), 201
    except Exception as e:
        db.session.rollback()
        print(f"❌ خطأ تسجيل: {e}", file=sys.stderr)
        return jsonify({"error": "خطأ في الخادم"}), 500


@app.post("/api/auth/login")
@rate_limit(max_hits=10, window_s=900, scope="login")
def api_login():
    data = request.get_json() or {}
    identifier = (data.get("identifier") or "").strip().lower()
    password = data.get("password") or ""
    remember = bool(data.get("remember", False))

    if not identifier or not password:
        return jsonify({"error": "أدخل بيانات الدخول"}), 400

    try:
        user = User.query.filter(
            db.or_(User.email == identifier, User.username == identifier)
        ).first()

        if not user or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "بيانات الدخول غير صحيحة"}), 401

        session.permanent = remember
        session["user_id"] = user.id
        _get_csrf_token()
        return jsonify(_payload(user))
    except Exception as e:
        print(f"❌ خطأ دخول: {e}", file=sys.stderr)
        return jsonify({"error": "خطأ في الخادم"}), 500


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    return jsonify(_payload(current_user()))


@app.post("/api/auth/check-username")
def api_check_username():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip().lower()
    if not _validate_username(username):
        return jsonify({"available": False, "reason": "format"})
    exists = User.query.filter_by(username=username).first() is not None
    return jsonify({"available": not exists, "reason": "taken" if exists else "ok"})


@app.post("/api/auth/check-email")
def api_check_email():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    if not _validate_email(email):
        return jsonify({"available": False, "reason": "format"})
    exists = User.query.filter_by(email=email).first() is not None
    return jsonify({"available": not exists, "reason": "taken" if exists else "ok"})


# ═══════════════════════════════════════════════════════════
# صيانة
# ═══════════════════════════════════════════════════════════
@app.get("/api/db-test")
def api_db_test():
    report = test_connection(app)
    status = 200 if report["connected"] else 503
    return jsonify(report), status


@app.get("/admin/db-status")
def admin_db_status():
    try:
        insp = inspect(db.engine)
        tables = insp.get_table_names()
        out = {
            "mode": "render" if _IS_PROD else "local",
            "tables": tables,
            "columns": {},
            "row_counts": {},
        }
        for t in tables:
            out["columns"][t] = [c["name"] for c in insp.get_columns(t)]
        for model in [User, Post, Comment, Like, Save, Follow, Chat, Message,
                      Notification, Report]:
            try:
                out["row_counts"][model.__tablename__] = model.query.count()
            except Exception:
                out["row_counts"][model.__tablename__] = "error"
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/admin/db-reset")
def admin_db_reset():
    key = request.args.get("key", "")
    expected = os.getenv("ADMIN_RESET_KEY", "")
    if not expected or key != expected:
        abort(403)
    try:
        db.drop_all()
        db.create_all()
        return jsonify({
            "status": "ok",
            "message": "تم إعادة إنشاء الجداول",
            "tables": inspect(db.engine).get_table_names(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/admin/db-migrate")
def admin_db_migrate():
    key = request.args.get("key", "")
    if not key or key != os.getenv("ADMIN_RESET_KEY", ""):
        abort(403)
    try:
        with db.engine.begin() as conn:
            cols = [
                ("website",      "VARCHAR(120)"),
                ("pronouns",     "VARCHAR(20)"),
                ("cover",        "VARCHAR(40) DEFAULT 'aurora'"),
                ("accent_color", "VARCHAR(7)  DEFAULT '#22D3EE'"),
                ("avatar_shape", "VARCHAR(30) DEFAULT 'ring'"),
                ("card_style",   "VARCHAR(12) DEFAULT 'glass'"),
                ("preferences",  "TEXT DEFAULT '{}'"),
            ]
            for name, dtype in cols:
                conn.execute(text(
                    f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {dtype}"
                ))

            # ── v14.1: أعمدة جديدة لـ posts ──
            conn.execute(text(
                "ALTER TABLE posts ADD COLUMN IF NOT EXISTS "
                "updated_at TIMESTAMP DEFAULT NOW()"
            ))
            conn.execute(text(
                "UPDATE posts SET updated_at = created_at "
                "WHERE updated_at IS NULL"
            ))
            conn.execute(text(
                "ALTER TABLE posts ADD COLUMN IF NOT EXISTS "
                "images TEXT"
            ))

            try:
                conn.execute(text(
                    "ALTER TABLE users ALTER COLUMN avatar_shape TYPE VARCHAR(30)"
                ))
            except Exception:
                pass

            conn.execute(text("""
                UPDATE users SET avatar_shape = CASE
                    WHEN avatar_shape = 'circle'  THEN 'gradient'
                    WHEN avatar_shape = 'rounded' THEN 'ring'
                    WHEN avatar_shape = 'square'  THEN 'none'
                    ELSE avatar_shape
                END
                WHERE avatar_shape IN ('circle', 'rounded', 'square') OR avatar_shape IS NULL
            """))

            conn.execute(text("UPDATE users SET cover = 'aurora' WHERE cover IS NULL"))
            conn.execute(text("UPDATE users SET accent_color = '#22D3EE' WHERE accent_color IS NULL"))
            conn.execute(text("UPDATE users SET avatar_shape = 'ring' WHERE avatar_shape IS NULL"))
            conn.execute(text("UPDATE users SET card_style = 'glass' WHERE card_style IS NULL"))
            conn.execute(text("UPDATE users SET preferences = '{}' WHERE preferences IS NULL"))

        return jsonify({"ok": True, "message": "تمت إضافة الأعمدة بنجاح"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# البرومبتات
# ═══════════════════════════════════════════════════════════
@app.get("/api/posts")
def api_posts():
    q = request.args.get("q", "").strip()
    tag = request.args.get("tag", "").strip()
    model = request.args.get("model", "").strip()
    author = request.args.get("author")
    sort = request.args.get("sort", "recent")
    limit = min(int(request.args.get("limit", 20)), 50)
    before_id = request.args.get("before_id")

    query = Post.query

    if q:
        like = f"%{q}%"
        query = query.filter(db.or_(
            Post.title.ilike(like),
            Post.prompt.ilike(like),
            Post.tags.ilike(like),
        ))
    if tag:
        query = query.filter(Post.tags.ilike(f"%{tag}%"))
    if model:
        query = query.filter(Post.model == model)
    if author:
        try:
            query = query.filter(Post.author_id == int(author))
        except ValueError:
            pass

    if before_id:
        try:
            bid = int(before_id)
            query = query.filter(Post.id < bid)
        except (ValueError, TypeError):
            pass

    query = query.options(joinedload(Post.author))

    if sort == "top":
        query = query.order_by(Post.likes.desc(), Post.id.desc())
    else:
        query = query.order_by(Post.id.desc())

    posts = query.limit(limit).all()
    me = current_user()

    post_ids = [p.id for p in posts]
    liked_ids = set()
    saved_ids = set()

    if me and post_ids:
        liked_rows = db.session.query(Like.post_id).filter(
            Like.user_id == me.id, Like.post_id.in_(post_ids)
        ).all()
        liked_ids = {r[0] for r in liked_rows}

        saved_rows = db.session.query(Save.post_id).filter(
            Save.user_id == me.id, Save.post_id.in_(post_ids)
        ).all()
        saved_ids = {r[0] for r in saved_rows}

    out = []
    for p in posts:
        d = p.to_dict()
        d["author_data"] = p.author.to_dict()
        d["liked"] = p.id in liked_ids
        d["saved"] = p.id in saved_ids
        d["is_owner"] = bool(me and me.id == p.author_id)
        out.append(d)

    resp = jsonify(out)
    resp.headers["Cache-Control"] = (
        "private, max-age=15" if me else "public, max-age=30"
    )
    resp.headers["X-Has-More"] = "true" if len(posts) == limit else "false"
    return resp


@app.get("/api/posts/<int:pid>")
def api_post(pid):
    p = db.session.get(Post, pid)
    if not p:
        abort(404)
    d = p.to_dict()
    d["author_data"] = p.author.to_dict()
    me = current_user()
    if me:
        d["liked"] = db.session.query(Like).filter_by(
            user_id=me.id, post_id=p.id
        ).first() is not None
        d["saved"] = db.session.query(Save).filter_by(
            user_id=me.id, post_id=p.id
        ).first() is not None
        d["is_owner"] = (me.id == p.author_id)
    else:
        d["is_owner"] = False
    return jsonify(d)


@app.post("/api/posts")
@require_auth
def api_create_post():
    u = g.user
    data = request.get_json() or {}
    title = (data.get("title") or "").strip()
    prompt = (data.get("prompt") or "").strip()

    if not title or not prompt:
        return jsonify({"error": "العنوان والنص مطلوبان"}), 400
    if len(title) > 200:
        return jsonify({"error": "العنوان طويل جداً (200 حرف كحد أقصى)"}), 400
    if len(prompt) > 5000:
        return jsonify({"error": "النص طويل جداً (5000 حرف كحد أقصى)"}), 400

    image = (data.get("image") or "").strip() or None
    if image and not _validate_url(image, max_len=1024):
        return jsonify({"error": "رابط الصورة غير صالح"}), 400

    model = (data.get("model") or "").strip()[:64] or None

    tags_raw = data.get("tags") or []
    if isinstance(tags_raw, str):
        tags_raw = [t.strip() for t in tags_raw.split(",")]
    tags = [t[:30] for t in tags_raw if t.strip()][:8]

    post = Post(
        author_id=u.id,
        title=title,
        prompt=prompt,
        image=image,
        model=model,
        tags=",".join(tags),
    )
    db.session.add(post)
    db.session.commit()
    d = post.to_dict()
    d["author_data"] = u.to_dict()
    d["liked"] = False
    d["saved"] = False
    d["is_owner"] = True
    return jsonify(d), 201


@app.patch("/api/posts/<int:pid>")
@require_auth
def api_update_post(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    if post.author_id != u.id:
        abort(403)

    data = request.get_json() or {}

    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "العنوان مطلوب"}), 400
        if len(title) > 200:
            return jsonify({"error": "العنوان طويل جداً"}), 400
        post.title = title

    if "prompt" in data:
        prompt = (data.get("prompt") or "").strip()
        if not prompt:
            return jsonify({"error": "النص مطلوب"}), 400
        if len(prompt) > 5000:
            return jsonify({"error": "النص طويل جداً"}), 400
        post.prompt = prompt

    if "image" in data:
        image = (data.get("image") or "").strip() or None
        if image and not _validate_url(image, max_len=1024):
            return jsonify({"error": "رابط الصورة غير صالح"}), 400
        post.image = image

    if "model" in data:
        post.model = (data.get("model") or "").strip()[:64] or None

    if "tags" in data:
        tags_raw = data.get("tags") or []
        if isinstance(tags_raw, str):
            tags_raw = [t.strip() for t in tags_raw.split(",")]
        tags = [t[:30] for t in tags_raw if t.strip()][:8]
        post.tags = ",".join(tags)

    db.session.commit()
    d = post.to_dict()
    d["author_data"] = post.author.to_dict()
    d["is_owner"] = True
    return jsonify(d)


@app.delete("/api/posts/<int:pid>")
@require_auth
def api_delete_post(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    if post.author_id != u.id:
        abort(403)
    db.session.delete(post)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/posts/<int:pid>/like")
@require_auth
def api_like(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    existing = Like.query.filter_by(user_id=u.id, post_id=pid).first()
    if existing:
        db.session.delete(existing)
        post.likes = max(0, post.likes - 1)
        liked = False
    else:
        db.session.add(Like(user_id=u.id, post_id=pid))
        post.likes += 1
        liked = True
        _notify(
            user_id=post.author_id,
            actor_id=u.id,
            kind="like",
            target_type="post",
            target_id=post.id,
            text=post.title[:120],
        )
    db.session.commit()
    return jsonify({"liked": liked, "likes": post.likes})


@app.post("/api/posts/<int:pid>/save")
@require_auth
def api_save(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    existing = Save.query.filter_by(user_id=u.id, post_id=pid).first()
    if existing:
        db.session.delete(existing)
        post.saves = max(0, post.saves - 1)
        saved = False
    else:
        db.session.add(Save(user_id=u.id, post_id=pid))
        post.saves += 1
        saved = True
    db.session.commit()
    return jsonify({"saved": saved, "saves": post.saves})


@app.post("/api/posts/<int:pid>/copy")
def api_copy(pid):
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    post.copies += 1
    db.session.commit()
    return jsonify({"copies": post.copies})


# ═══════════════════════════════════════════════════════════
# التعليقات
# ═══════════════════════════════════════════════════════════
@app.get("/api/posts/<int:pid>/comments")
def api_comments(pid):
    if not db.session.get(Post, pid):
        abort(404)
    cs = Comment.query.filter_by(post_id=pid)\
                      .order_by(Comment.created_at.desc()).all()
    return jsonify([
        {**c.to_dict(), "author_data": c.author.to_dict()} for c in cs
    ])


@app.post("/api/posts/<int:pid>/comments")
@require_auth
def api_add_comment(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    text_ = ((request.get_json() or {}).get("text") or "").strip()
    if not text_:
        return jsonify({"error": "نص التعليق مطلوب"}), 400
    if len(text_) > 1000:
        return jsonify({"error": "التعليق طويل جداً"}), 400

    c = Comment(post_id=pid, author_id=u.id, text=text_)
    db.session.add(c)

    _notify(
        user_id=post.author_id,
        actor_id=u.id,
        kind="comment",
        target_type="post",
        target_id=post.id,
        text=text_[:200],
    )

    db.session.commit()
    return jsonify({**c.to_dict(), "author_data": u.to_dict()}), 201


@app.delete("/api/comments/<int:cid>")
@require_auth
def api_delete_comment(cid):
    u = g.user
    c = db.session.get(Comment, cid)
    if not c:
        abort(404)
    if c.author_id != u.id:
        abort(403)
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════
# البلاغات
# ═══════════════════════════════════════════════════════════
@app.post("/api/posts/<int:pid>/report")
@require_auth
@rate_limit(max_hits=10, window_s=3600, scope="report")
def api_report_post(pid):
    u = g.user
    post = db.session.get(Post, pid)
    if not post:
        abort(404)
    if post.author_id == u.id:
        return jsonify({"error": "لا يمكنك الإبلاغ عن منشورك"}), 400

    data = request.get_json() or {}
    reason = (data.get("reason") or "").strip()
    note = (data.get("note") or "").strip()[:500]

    if reason not in ALLOWED_REPORT_REASONS:
        return jsonify({"error": "سبب غير صالح"}), 400

    existing = Report.query.filter_by(
        reporter_id=u.id, target_type="post",
        target_id=pid, status="pending"
    ).first()
    if existing:
        return jsonify({"error": "لديك بلاغ قائم على هذا المنشور"}), 409

    r = Report(
        reporter_id=u.id,
        target_type="post",
        target_id=pid,
        reason=reason,
        note=note,
    )
    db.session.add(r)
    db.session.commit()
    return jsonify({"ok": True, "id": r.id}), 201


# ═══════════════════════════════════════════════════════════
# المستخدمون
# ═══════════════════════════════════════════════════════════
@app.get("/api/users/<int:uid>")
def api_user(uid):
    u = db.session.get(User, uid)
    if not u:
        abort(404)

    d = u.to_dict()
    d["posts_count"] = u.posts.count()
    d["total_likes"] = 0
    d["total_copies"] = 0

    totals = db.session.query(
        func.coalesce(func.sum(Post.likes), 0),
        func.coalesce(func.sum(Post.copies), 0),
    ).filter(Post.author_id == uid).first()
    if totals:
        d["total_likes"] = int(totals[0])
        d["total_copies"] = int(totals[1])

    me = current_user()
    d["is_following"] = False
    if me and me.id != uid:
        d["is_following"] = Follow.query.filter_by(
            follower_id=me.id, following_id=uid
        ).first() is not None

    return jsonify(d)


@app.get("/api/users/<int:uid>/posts")
def api_user_posts(uid):
    if not db.session.get(User, uid):
        abort(404)

    limit = min(int(request.args.get("limit", 20)), 50)
    before_id = request.args.get("before_id")

    query = Post.query.filter_by(author_id=uid)\
                      .options(joinedload(Post.author))\
                      .order_by(Post.id.desc())

    if before_id:
        try:
            query = query.filter(Post.id < int(before_id))
        except (ValueError, TypeError):
            pass

    posts = query.limit(limit).all()
    me = current_user()

    post_ids = [p.id for p in posts]
    liked_ids = set()
    saved_ids = set()
    if me and post_ids:
        liked_rows = db.session.query(Like.post_id).filter(
            Like.user_id == me.id, Like.post_id.in_(post_ids)
        ).all()
        liked_ids = {r[0] for r in liked_rows}
        saved_rows = db.session.query(Save.post_id).filter(
            Save.user_id == me.id, Save.post_id.in_(post_ids)
        ).all()
        saved_ids = {r[0] for r in saved_rows}

    out = []
    for p in posts:
        d = p.to_dict()
        d["author_data"] = p.author.to_dict()
        d["liked"] = p.id in liked_ids
        d["saved"] = p.id in saved_ids
        d["is_owner"] = bool(me and me.id == p.author_id)
        out.append(d)

    resp = jsonify(out)
    resp.headers["X-Has-More"] = "true" if len(posts) == limit else "false"
    return resp


@app.get("/api/users/search")
def api_users_search():
    """v14.2 — Search users by name/username/handle."""
    q = request.args.get("q", "").strip()
    limit = min(int(request.args.get("limit", 20)), 50)
    before_id = request.args.get("before_id")

    if not q or len(q) < 2:
        return jsonify({"items": [], "next_before": None})

    like = f"%{q}%"
    query = User.query.filter(
        db.or_(
            User.name.ilike(like),
            User.username.ilike(like),
            User.handle.ilike(like),
        )
    )

    if before_id:
        try:
            query = query.filter(User.id < int(before_id))
        except (ValueError, TypeError):
            pass

    query = query.order_by(User.followers.desc(), User.id.desc())
    users = query.limit(limit).all()

    me = current_user()
    out = []
    for u in users:
        d = u.to_dict()
        if me and me.id != u.id:
            d["is_following"] = Follow.query.filter_by(
                follower_id=me.id, following_id=u.id
            ).first() is not None
        else:
            d["is_following"] = False
        out.append(d)

    last_id = users[-1].id if users else None
    return jsonify({
        "items": out,
        "next_before": last_id if len(users) == limit else None,
    })


@app.get("/api/users/<int:uid>/followers")
def api_user_followers(uid):
    target = db.session.get(User, uid)
    if not target:
        abort(404)

    limit = min(int(request.args.get("limit", 30)), 100)
    before_id = request.args.get("before_id")

    query = Follow.query.filter_by(following_id=uid)\
                        .order_by(Follow.id.desc())
    if before_id:
        try:
            query = query.filter(Follow.id < int(before_id))
        except (ValueError, TypeError):
            pass

    rows = query.limit(limit).all()
    out = []
    last_id = None
    for r in rows:
        u = db.session.get(User, r.follower_id)
        if u:
            out.append(u.to_dict())
            last_id = r.id

    return jsonify({
        "items": out,
        "next_before": last_id if len(rows) == limit else None,
        "total": target.followers,
    })


@app.get("/api/users/<int:uid>/following")
def api_user_following(uid):
    target = db.session.get(User, uid)
    if not target:
        abort(404)

    limit = min(int(request.args.get("limit", 30)), 100)
    before_id = request.args.get("before_id")

    query = Follow.query.filter_by(follower_id=uid)\
                        .order_by(Follow.id.desc())
    if before_id:
        try:
            query = query.filter(Follow.id < int(before_id))
        except (ValueError, TypeError):
            pass

    rows = query.limit(limit).all()
    out = []
    last_id = None
    for r in rows:
        u = db.session.get(User, r.following_id)
        if u:
            out.append(u.to_dict())
            last_id = r.id

    return jsonify({
        "items": out,
        "next_before": last_id if len(rows) == limit else None,
        "total": target.following,
    })


@app.post("/api/users/<int:uid>/follow")
@require_auth
def api_follow(uid):
    me = g.user
    if me.id == uid:
        return jsonify({"error": "لا يمكن متابعة نفسك"}), 400
    target = db.session.get(User, uid)
    if not target:
        abort(404)

    existing = Follow.query.filter_by(
        follower_id=me.id, following_id=uid
    ).first()
    if existing:
        db.session.delete(existing)
        me.following = max(0, me.following - 1)
        target.followers = max(0, target.followers - 1)
        following = False
    else:
        db.session.add(Follow(follower_id=me.id, following_id=uid))
        me.following += 1
        target.followers += 1
        following = True
        _notify(
            user_id=uid,
            actor_id=me.id,
            kind="follow",
            target_type="user",
            target_id=me.id,
            text=me.name[:100],
        )
    db.session.commit()
    return jsonify({"following": following, "followers": target.followers})


@app.patch("/api/me")
@require_auth
def api_update_me():
    u = g.user
    data = request.get_json() or {}

    if "name" in data:
        name = (data["name"] or "").strip()
        if len(name) < 2:
            return jsonify({"error": "الاسم قصير جداً"}), 400
        if len(name) > 80:
            return jsonify({"error": "الاسم طويل جداً"}), 400
        u.name = name

    if "bio" in data:
        bio = (data["bio"] or "").strip()
        if len(bio) > 300:
            return jsonify({"error": "النبذة طويلة جداً"}), 400
        u.bio = bio

    if "website" in data:
        web = (data["website"] or "").strip()
        if web:
            if not web.startswith("http://") and not web.startswith("https://"):
                web = "https://" + web
            if not _validate_url(web, max_len=120):
                return jsonify({"error": "رابط الموقع غير صالح"}), 400
        u.website = web[:120] if web else None

    if "pronouns" in data:
        pr = (data["pronouns"] or "").strip()
        if pr not in ALLOWED_PRONOUNS:
            return jsonify({"error": "ضمير غير صالح"}), 400
        u.pronouns = pr or None

    if "avatar" in data and data["avatar"]:
        av = data["avatar"].strip()
        if not _validate_url(av, max_len=500):
            return jsonify({"error": "رابط الصورة الشخصية غير صالح"}), 400
        u.avatar = av

    if "cover" in data:
        cv = (data["cover"] or "").strip()
        if cv in ALLOWED_COVERS:
            u.cover = cv

    if "accent_color" in data:
        ac = (data["accent_color"] or "").strip()
        if re.match(r"^#[0-9A-Fa-f]{6}$", ac):
            u.accent_color = ac

    frame_val = None
    if "avatar_frame" in data:
        frame_val = (data["avatar_frame"] or "").strip()
    elif "avatar_shape" in data:
        frame_val = (data["avatar_shape"] or "").strip()
    if frame_val is not None and frame_val in ALLOWED_FRAMES:
        u.avatar_shape = frame_val

    if "card_style" in data:
        cs = (data["card_style"] or "").strip()
        if cs in ALLOWED_CARD_STYLES:
            u.card_style = cs

    if "preferences" in data:
        prefs = data["preferences"]
        if not isinstance(prefs, dict):
            return jsonify({"error": "preferences يجب أن يكون كائناً"}), 400

        clean = {}

        notif_in = prefs.get("notif")
        if isinstance(notif_in, dict):
            clean["notif"] = {}
            for k in ("likes", "comments", "follows", "messages"):
                if k in notif_in:
                    clean["notif"][k] = bool(notif_in[k])

        priv_in = prefs.get("priv")
        if isinstance(priv_in, dict):
            clean["priv"] = {}
            for k in ("public_profile", "allow_messages", "show_website"):
                if k in priv_in:
                    clean["priv"][k] = bool(priv_in[k])

        try:
            u.preferences = json.dumps(clean, ensure_ascii=False)
        except Exception:
            return jsonify({"error": "preferences غير صالح"}), 400

    db.session.commit()
    return jsonify(_payload(u))


@app.post("/api/me/password")
@require_auth
@rate_limit(max_hits=5, window_s=3600, scope="password")
def api_change_password():
    u = g.user
    data = request.get_json() or {}
    old = data.get("old_password") or ""
    new = data.get("new_password") or ""

    if not check_password_hash(u.password_hash, old):
        return jsonify({"error": "كلمة المرور الحالية غير صحيحة"}), 401
    if not _validate_password(new):
        return jsonify({"error": "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل"}), 400

    u.password_hash = generate_password_hash(
        new, method="pbkdf2:sha256", salt_length=16
    )
    db.session.commit()
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════
# الإشعارات
# ═══════════════════════════════════════════════════════════
@app.get("/api/notifications")
@require_auth
def api_notifications():
    me = g.user
    limit = min(int(request.args.get("limit", 30)), 100)
    before_id = request.args.get("before_id")
    unread_only = request.args.get("unread") == "1"

    query = Notification.query.filter_by(user_id=me.id)\
                              .options(joinedload(Notification.actor))\
                              .order_by(Notification.id.desc())

    if unread_only:
        query = query.filter_by(read=False)
    if before_id:
        try:
            query = query.filter(Notification.id < int(before_id))
        except (ValueError, TypeError):
            pass

    rows = query.limit(limit).all()
    last_id = rows[-1].id if rows else None

    unread_count = Notification.query.filter_by(
        user_id=me.id, read=False
    ).count()

    return jsonify({
        "items": [n.to_dict() for n in rows],
        "next_before": last_id if len(rows) == limit else None,
        "unread": unread_count,
    })


@app.post("/api/notifications/<int:nid>/read")
@require_auth
def api_notification_read(nid):
    me = g.user
    n = db.session.get(Notification, nid)
    if not n or n.user_id != me.id:
        abort(404)
    n.read = True
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/notifications/read-all")
@require_auth
def api_notifications_read_all():
    me = g.user
    Notification.query.filter_by(user_id=me.id, read=False)\
                      .update({"read": True})
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/notifications/unread-count")
@require_auth
def api_notifications_unread_count():
    me = g.user
    c = Notification.query.filter_by(user_id=me.id, read=False).count()
    return jsonify({"count": c})


# ═══════════════════════════════════════════════════════════
# الدردشة
# ═══════════════════════════════════════════════════════════
@app.get("/api/chats")
@require_auth
def api_chats():
    me = g.user
    chats = Chat.query.filter(db.or_(
        Chat.user_a_id == me.id,
        Chat.user_b_id == me.id,
    )).all()
    out = []
    for c in chats:
        other_id = c.user_b_id if c.user_a_id == me.id else c.user_a_id
        other = db.session.get(User, other_id)
        last = c.messages.order_by(Message.created_at.desc()).first()
        unread = c.messages.filter_by(read=False)\
                          .filter(Message.sender_id != me.id).count()
        out.append({
            "id": c.id,
            "with_user": other.to_dict() if other else None,
            "last": last.text if last else "",
            "time": last.created_at.strftime("%H:%M") if last else "",
            "unread": unread,
        })
    return jsonify(out)


@app.get("/api/chats/<int:cid>/messages")
@require_auth
def api_messages(cid):
    me = g.user
    chat = db.session.get(Chat, cid)
    if not chat:
        abort(404)
    if me.id not in (chat.user_a_id, chat.user_b_id):
        abort(403)
    msgs = chat.messages.order_by(Message.created_at.asc()).all()
    for m in msgs:
        if m.sender_id != me.id and not m.read:
            m.read = True
    db.session.commit()
    return jsonify([{
        "id": m.id,
        "text": m.text,
        "from": "me" if m.sender_id == me.id else "them",
        "time": m.created_at.strftime("%H:%M"),
    } for m in msgs])


@app.post("/api/chats/<int:cid>/messages")
@require_auth
def api_send_message(cid):
    me = g.user
    chat = db.session.get(Chat, cid)
    if not chat:
        abort(404)
    if me.id not in (chat.user_a_id, chat.user_b_id):
        abort(403)
    text_ = ((request.get_json() or {}).get("text") or "").strip()
    if not text_:
        return jsonify({"error": "الرسالة فارغة"}), 400
    if len(text_) > 2000:
        return jsonify({"error": "الرسالة طويلة جداً"}), 400

    m = Message(chat_id=cid, sender_id=me.id, text=text_)
    db.session.add(m)

    other_id = chat.user_b_id if chat.user_a_id == me.id else chat.user_a_id
    _notify(
        user_id=other_id,
        actor_id=me.id,
        kind="message",
        target_type="chat",
        target_id=cid,
        text=text_[:200],
    )

    db.session.commit()
    return jsonify({
        "id": m.id, "text": m.text, "from": "me",
        "time": m.created_at.strftime("%H:%M"),
    }), 201


@app.post("/api/chats/with/<int:uid>")
@require_auth
def api_open_chat(uid):
    me = g.user
    if me.id == uid:
        abort(400)
    chat = Chat.query.filter(db.or_(
        db.and_(Chat.user_a_id == me.id, Chat.user_b_id == uid),
        db.and_(Chat.user_a_id == uid, Chat.user_b_id == me.id),
    )).first()
    if not chat:
        chat = Chat(user_a_id=me.id, user_b_id=uid)
        db.session.add(chat)
        db.session.commit()
    return jsonify({"id": chat.id})


# ═══════════════════════════════════════════════════════════
# الصحة
# ═══════════════════════════════════════════════════════════
@app.get("/api/health")
def health():
    try:
        return jsonify({
            "status": "ok",
            "db": "connected",
            "auth": "local",
            "mode": "render" if _IS_PROD else "local",
            "users": User.query.count(),
            "posts": Post.query.count(),
            "time": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# معالجات الأخطاء
# ═══════════════════════════════════════════════════════════
@app.errorhandler(400)
def err_400(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "طلب غير صالح"}), 400
    return render_template("error.html", code=400,
                           title="طلب غير صالح",
                           message="تحقّق من البيانات وأعد المحاولة."), 400


@app.errorhandler(401)
def err_401(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "يجب تسجيل الدخول"}), 401
    return render_template("error.html", code=401,
                           title="تحتاج تسجيل الدخول",
                           message="سجّل دخولك للوصول إلى هذه الصفحة."), 401


@app.errorhandler(403)
def err_403(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "غير مسموح"}), 403
    return render_template("error.html", code=403,
                           title="غير مسموح",
                           message="لا تملك صلاحية الوصول."), 403


@app.errorhandler(404)
def err_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "غير موجود"}), 404
    return render_template("error.html", code=404,
                           title="الصفحة غير موجودة",
                           message="يبدو أن الرابط غير صحيح."), 404


@app.errorhandler(429)
def err_429(e):
    return jsonify({"error": "محاولات كثيرة — حاول لاحقاً"}), 429


@app.errorhandler(413)
def err_413(e):
    return jsonify({"error": "الطلب كبير جداً"}), 413


@app.errorhandler(500)
def err_500(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "خطأ في الخادم"}), 500
    return render_template("error.html", code=500,
                           title="حدث خطأ",
                           message="نعتذر، حدث خطأ غير متوقع."), 500


@app.errorhandler(Exception)
def err_all(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e

    err_str = str(e)
    if "SSL error" in err_str or "decryption failed" in err_str:
        print(f"⚠️ SSL connection error: {err_str[:120]}", file=sys.stderr)
        try:
            db.session.rollback()
            db.session.remove()
        except Exception:
            pass
        return jsonify({"error": "تعذّر الاتصال بقاعدة البيانات، حاول مرة أخرى"}), 503

    print(f"❌ Unhandled: {e}", file=sys.stderr)
    if request.path.startswith("/api/"):
        return jsonify({"error": f"خطأ غير متوقع: {str(e)}"}), 500
    return render_template("error.html", code=500,
                           title="حدث خطأ",
                           message="نعتذر، حدث خطأ غير متوقع."), 500


# ═══════════════════════════════════════════════════════════
# تهيئة قاعدة البيانات + Auto-migration (v14.2)
# ═══════════════════════════════════════════════════════════
def init_db():
    with app.app_context():
        try:
            print("\n" + "═" * 60)
            print("🔌 اختبار الاتصال بقاعدة البيانات…")

            report = test_connection(app)

            if not report["connected"]:
                print("❌ فشل الاتصال!")
                print(f"   النوع: {report.get('error_type', 'Unknown')}")
                print(f"   الرسالة: {str(report.get('error', ''))[:200]}")
                print(f"   المضيف: {report.get('host')}:{report.get('port')}")
                print(f"   الوضع: {report['mode']}")
                print("═" * 60 + "\n")
                return

            print(f"✅ متصل بـ: {report['host']}:{report['port']}")
            print(f"⏱️  الاستجابة: {report['latency_ms']}ms")
            print(f"🔧 الوضع: {report['mode']}")
            if report.get("server_version"):
                print(f"📦 {report['server_version'][:60]}…")

            db.create_all()
            print("✅ الجداول جاهزة.")

            try:
                with db.engine.begin() as conn:
                    cols = [
                        ("website",      "VARCHAR(120)"),
                        ("pronouns",     "VARCHAR(20)"),
                        ("cover",        "VARCHAR(40) DEFAULT 'aurora'"),
                        ("accent_color", "VARCHAR(7)  DEFAULT '#22D3EE'"),
                        ("avatar_shape", "VARCHAR(30) DEFAULT 'ring'"),
                        ("card_style",   "VARCHAR(12) DEFAULT 'glass'"),
                        ("preferences",  "TEXT DEFAULT '{}'"),
                    ]
                    for name, dtype in cols:
                        conn.execute(text(
                            f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {dtype}"
                        ))

                    # ── v14.1/v14.2: أعمدة جديدة لـ posts ──
                    conn.execute(text(
                        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS "
                        "updated_at TIMESTAMP DEFAULT NOW()"
                    ))
                    conn.execute(text(
                        "UPDATE posts SET updated_at = created_at "
                        "WHERE updated_at IS NULL"
                    ))
                    conn.execute(text(
                        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS "
                        "images TEXT"
                    ))

                    try:
                        conn.execute(text(
                            "ALTER TABLE users ALTER COLUMN avatar_shape TYPE VARCHAR(30)"
                        ))
                    except Exception:
                        pass

                    conn.execute(text("""
                        UPDATE users SET avatar_shape = CASE
                            WHEN avatar_shape = 'circle'  THEN 'gradient'
                            WHEN avatar_shape = 'rounded' THEN 'ring'
                            WHEN avatar_shape = 'square'  THEN 'none'
                            ELSE avatar_shape
                        END
                        WHERE avatar_shape IN ('circle', 'rounded', 'square')
                           OR avatar_shape IS NULL
                    """))

                    conn.execute(text("UPDATE users SET cover = 'aurora' WHERE cover IS NULL"))
                    conn.execute(text("UPDATE users SET accent_color = '#22D3EE' WHERE accent_color IS NULL"))
                    conn.execute(text("UPDATE users SET avatar_shape = 'ring' WHERE avatar_shape IS NULL"))
                    conn.execute(text("UPDATE users SET card_style = 'glass' WHERE card_style IS NULL"))
                    conn.execute(text("UPDATE users SET preferences = '{}' WHERE preferences IS NULL"))

                print("✅ Auto-migration v14.2: updated_at + images + الإشعارات والبلاغات جاهزة.")
            except Exception as m_err:
                print(f"⚠️  Auto-migration: {str(m_err)[:150]}")

            try:
                users_count = User.query.count()
                posts_count = Post.query.count()
                notif_count = Notification.query.count()
                print(f"📊 المستخدمون: {users_count} | البرومبتات: {posts_count} | الإشعارات: {notif_count}")
            except Exception as qerr:
                print(f"⚠️  تعذّر قراءة الإحصاءات: {str(qerr)[:100]}")

            print("═" * 60 + "\n")

        except Exception as e:
            print(f"⚠️  فشل التهيئة: {e}", file=sys.stderr)


init_db()


# ═══════════════════════════════════════════════════════════
# التشغيل
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"

    if _is_local_mode():
        print(f"\n🚀 خَيال على: http://localhost:{port}")
        print(f"📊 اختبار: http://localhost:{port}/api/db-test")
        print(f"📋 الجداول: http://localhost:{port}/admin/db-status\n")

    app.run(host="0.0.0.0", port=port, debug=debug)