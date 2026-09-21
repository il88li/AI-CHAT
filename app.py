"""
خَيال — منصة البرومبتات العربية
Flask + PostgreSQL + تسجيل دخول محلي + مسارات صيانة
محسّن للتطوير من الهاتف والإنتاج على Render
"""
import os
import sys
import re
import time
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, render_template, jsonify, request, session,
                   abort, redirect, url_for, make_response, send_from_directory,
                   g)
from flask_compress import Compress
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import inspect, text
from dotenv import load_dotenv

from database import (db, build_database_uri, test_connection,
                      User, Post, Comment, Like, Save, Follow, Chat, Message)

load_dotenv()


# ═══════════════════════════════════════════════════════════
# إعداد التطبيق
# ═══════════════════════════════════════════════════════════
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

# ─── الأمان والجلسة ───
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_SECURE"]    = os.getenv("FLASK_ENV") == "production"
app.config["SESSION_COOKIE_HTTPONLY"]  = True
app.config["SESSION_COOKIE_SAMESITE"]  = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

# ─── قاعدة البيانات ───
app.config["SQLALCHEMY_DATABASE_URI"] = build_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# إعدادات مختلفة حسب البيئة
if os.getenv("RENDER"):
    # على Render: pool أكبر + keepalives
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 250,
        "pool_size": 5,
        "max_overflow": 3,
        "pool_timeout": 30,
        "connect_args": {
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 20,
            "keepalives_interval": 10,
            "keepalives_count": 5,
        },
    }
else:
    # محلياً (هاتف): pool أصغر + مهلة أطول
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True,
        "pool_recycle": 200,
        "pool_size": 2,
        "max_overflow": 1,
        "pool_timeout": 20,
        "connect_args": {
            "connect_timeout": 15,
            "keepalives": 1,
            "keepalives_idle": 30,
        },
    }

# ─── ضغط المحتوى ───
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
# Helpers
# ═══════════════════════════════════════════════════════════
def current_user():
    uid = session.get("user_id")
    return User.query.get(uid) if uid else None


def require_auth(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return jsonify({"error": "يجب تسجيل الدخول"}), 401
        g.user = u
        return fn(*a, **kw)
    return wrapper


def _payload(u):
    return u.to_dict() if u else None


def _validate_username(s):
    return bool(re.match(r"^[a-zA-Z0-9_\-]{3,32}$", s or ""))


def _validate_email(s):
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", s or ""))


def _validate_password(s):
    return isinstance(s, str) and len(s) >= 6


def _is_local_mode():
    return not bool(os.getenv("RENDER"))


# ═══════════════════════════════════════════════════════════
# الصفحات
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    return render_template("index.html", me=_payload(current_user()))


@app.route("/app")
def app_view():
    return render_template("index.html", me=_payload(current_user()))


@app.route("/offline")
def offline():
    return render_template("error.html", code=503,
                            title="لا يوجد اتصال",
                            message="يبدو أنك غير متصل بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.")


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
def api_register():
    data = request.get_json() or {}
    email    = (data.get("email") or "").strip().lower()
    username = (data.get("username") or "").strip()
    name     = (data.get("name") or "").strip()
    password = data.get("password") or ""

    if not email or not username or not name or not password:
        return jsonify({"error": "جميع الحقول مطلوبة"}), 400

    if not _validate_email(email):
        return jsonify({"error": "البريد الإلكتروني غير صحيح"}), 400

    if not _validate_username(username):
        return jsonify({"error": "اسم المستخدم يجب أن يكون 3-32 حرفاً (a-z, 0-9, _, -)"}), 400

    if len(name) < 2:
        return jsonify({"error": "الاسم يجب أن يكون حرفين على الأقل"}), 400

    if not _validate_password(password):
        return jsonify({"error": "كلمة المرور يجب أن تكون 6 أحرف على الأقل"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "البريد الإلكتروني مستخدم بالفعل"}), 409

    if User.query.filter_by(username=username.lower()).first():
        return jsonify({"error": "اسم المستخدم مستخدم بالفعل"}), 409

    handle = "@" + username.lower()
    if User.query.filter_by(handle=handle).first():
        return jsonify({"error": "اسم المستخدم مستخدم بالفعل"}), 409

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
        )
        db.session.add(user)
        db.session.commit()
        print(f"✅ مستخدم جديد: {user.username} ({user.email})")

        session.permanent = True
        session["user_id"] = user.id
        return jsonify(user.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        print(f"❌ خطأ في التسجيل: {e}", file=sys.stderr)
        return jsonify({"error": f"خطأ في الخادم: {str(e)}"}), 500


@app.post("/api/auth/login")
def api_login():
    data = request.get_json() or {}
    identifier = (data.get("identifier") or "").strip().lower()
    password   = data.get("password") or ""
    remember   = bool(data.get("remember", False))

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
        return jsonify(user.to_dict())
    except Exception as e:
        print(f"❌ خطأ في الدخول: {e}", file=sys.stderr)
        return jsonify({"error": f"خطأ في الخادم: {str(e)}"}), 500


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
# مسارات الصيانة والتشخيص
# ═══════════════════════════════════════════════════════════
@app.get("/api/db-test")
def api_db_test():
    """تقرير مفصّل عن حالة الاتصال بقاعدة البيانات."""
    report = test_connection(app)
    status = 200 if report["connected"] else 503
    return jsonify(report), status


@app.get("/admin/db-status")
def admin_db_status():
    """يعرض حالة الجداول والأعمدة وعدد السجلات."""
    try:
        insp = inspect(db.engine)
        tables = insp.get_table_names()
        out = {
            "mode": "render" if not _is_local_mode() else "local",
            "tables": tables,
            "columns": {},
            "row_counts": {},
        }
        for t in tables:
            out["columns"][t] = [c["name"] for c in insp.get_columns(t)]
        for model in [User, Post, Comment, Like, Save, Follow, Chat, Message]:
            try:
                out["row_counts"][model.__tablename__] = model.query.count()
            except Exception:
                out["row_counts"][model.__tablename__] = "error"
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.get("/admin/db-reset")
def admin_db_reset():
    """يحذف كل الجداول وينشئها من جديد. محمي بمفتاح."""
    key = request.args.get("key", "")
    expected = os.getenv("ADMIN_RESET_KEY", "")
    if not expected or key != expected:
        abort(403)
    try:
        db.drop_all()
        db.create_all()
        return jsonify({
            "status": "ok",
            "message": "تم إعادة إنشاء الجداول بنجاح",
            "tables": inspect(db.engine).get_table_names(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# البرومبتات
# ═══════════════════════════════════════════════════════════
@app.get("/api/posts")
def api_posts():
    q      = request.args.get("q", "").strip()
    tag    = request.args.get("tag", "").strip()
    model  = request.args.get("model", "").strip()
    author = request.args.get("author")
    sort   = request.args.get("sort", "recent")
    limit  = min(int(request.args.get("limit", 50)), 100)

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

    if sort == "top":
        query = query.order_by(Post.likes.desc(), Post.created_at.desc())
    else:
        query = query.order_by(Post.created_at.desc())

    posts = query.limit(limit).all()
    me = current_user()
    out = []
    for p in posts:
        d = p.to_dict()
        d["author_data"] = p.author.to_dict()
        if me:
            d["liked"] = db.session.query(Like).filter_by(
                user_id=me.id, post_id=p.id
            ).first() is not None
            d["saved"] = db.session.query(Save).filter_by(
                user_id=me.id, post_id=p.id
            ).first() is not None
        else:
            d["liked"] = False
            d["saved"] = False
        out.append(d)

    resp = jsonify(out)
    resp.headers["Cache-Control"] = (
        "private, max-age=15" if me else "public, max-age=30"
    )
    return resp


@app.get("/api/posts/<int:pid>")
def api_post(pid):
    p = Post.query.get_or_404(pid)
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
    return jsonify(d)


@app.post("/api/posts")
@require_auth
def api_create_post():
    u = g.user
    data = request.get_json() or {}
    title  = (data.get("title") or "").strip()
    prompt = (data.get("prompt") or "").strip()
    if not title or not prompt:
        return jsonify({"error": "العنوان والبرومبت مطلوبان"}), 400

    post = Post(
        author_id=u.id,
        title=title,
        prompt=prompt,
        image=(data.get("image") or "").strip() or None,
        model=(data.get("model") or "").strip() or None,
        tags=",".join([t.strip() for t in (data.get("tags") or []) if t.strip()]),
    )
    db.session.add(post)
    db.session.commit()
    d = post.to_dict()
    d["author_data"] = u.to_dict()
    d["liked"] = False
    d["saved"] = False
    return jsonify(d), 201


@app.delete("/api/posts/<int:pid>")
@require_auth
def api_delete_post(pid):
    u = g.user
    post = Post.query.get_or_404(pid)
    if post.author_id != u.id:
        abort(403)
    db.session.delete(post)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/posts/<int:pid>/like")
@require_auth
def api_like(pid):
    u = g.user
    post = Post.query.get_or_404(pid)
    existing = Like.query.filter_by(user_id=u.id, post_id=pid).first()
    if existing:
        db.session.delete(existing)
        post.likes = max(0, post.likes - 1)
        liked = False
    else:
        db.session.add(Like(user_id=u.id, post_id=pid))
        post.likes += 1
        liked = True
    db.session.commit()
    return jsonify({"liked": liked, "likes": post.likes})


@app.post("/api/posts/<int:pid>/save")
@require_auth
def api_save(pid):
    u = g.user
    post = Post.query.get_or_404(pid)
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
    post = Post.query.get_or_404(pid)
    post.copies += 1
    db.session.commit()
    return jsonify({"copies": post.copies})


# ═══════════════════════════════════════════════════════════
# التعليقات
# ═══════════════════════════════════════════════════════════
@app.get("/api/posts/<int:pid>/comments")
def api_comments(pid):
    Post.query.get_or_404(pid)
    cs = Comment.query.filter_by(post_id=pid)\
                      .order_by(Comment.created_at.desc()).all()
    return jsonify([
        {**c.to_dict(), "author_data": c.author.to_dict()} for c in cs
    ])


@app.post("/api/posts/<int:pid>/comments")
@require_auth
def api_add_comment(pid):
    u = g.user
    Post.query.get_or_404(pid)
    text = ((request.get_json() or {}).get("text") or "").strip()
    if not text:
        return jsonify({"error": "نص التعليق مطلوب"}), 400
    c = Comment(post_id=pid, author_id=u.id, text=text)
    db.session.add(c)
    db.session.commit()
    return jsonify({**c.to_dict(), "author_data": u.to_dict()}), 201


@app.delete("/api/comments/<int:cid>")
@require_auth
def api_delete_comment(cid):
    u = g.user
    c = Comment.query.get_or_404(cid)
    if c.author_id != u.id:
        abort(403)
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})


# ═══════════════════════════════════════════════════════════
# المستخدمون
# ═══════════════════════════════════════════════════════════
@app.get("/api/users/<int:uid>")
def api_user(uid):
    u = User.query.get_or_404(uid)
    d = u.to_dict()
    d["posts_count"] = u.posts.count()
    return jsonify(d)


@app.get("/api/users/<int:uid>/posts")
def api_user_posts(uid):
    User.query.get_or_404(uid)
    posts = Post.query.filter_by(author_id=uid)\
                      .order_by(Post.created_at.desc()).all()
    me = current_user()
    out = []
    for p in posts:
        d = p.to_dict()
        d["author_data"] = p.author.to_dict()
        if me:
            d["liked"] = db.session.query(Like).filter_by(
                user_id=me.id, post_id=p.id
            ).first() is not None
            d["saved"] = db.session.query(Save).filter_by(
                user_id=me.id, post_id=p.id
            ).first() is not None
        out.append(d)
    return jsonify(out)


@app.post("/api/users/<int:uid>/follow")
@require_auth
def api_follow(uid):
    me = g.user
    if me.id == uid:
        return jsonify({"error": "لا يمكن متابعة نفسك"}), 400
    target = User.query.get_or_404(uid)
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
    db.session.commit()
    return jsonify({"following": following, "followers": target.followers})


@app.patch("/api/me")
@require_auth
def api_update_me():
    u = g.user
    data = request.get_json() or {}
    if "name" in data:
        u.name = (data["name"] or "").strip() or u.name
    if "bio" in data:
        u.bio = (data["bio"] or "").strip()
    if "avatar" in data and data["avatar"]:
        u.avatar = data["avatar"].strip()
    db.session.commit()
    return jsonify(u.to_dict())


@app.post("/api/me/password")
@require_auth
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
        other = User.query.get(other_id)
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
    chat = Chat.query.get_or_404(cid)
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
    chat = Chat.query.get_or_404(cid)
    if me.id not in (chat.user_a_id, chat.user_b_id):
        abort(403)
    text = ((request.get_json() or {}).get("text") or "").strip()
    if not text:
        return jsonify({"error": "الرسالة فارغة"}), 400
    m = Message(chat_id=cid, sender_id=me.id, text=text)
    db.session.add(m)
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
            "mode": "render" if not _is_local_mode() else "local",
            "users": User.query.count(),
            "posts": Post.query.count(),
            "time": datetime.utcnow().isoformat(),
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ═══════════════════════════════════════════════════════════
# معالجات الأخطاء
# ═══════════════════════════════════════════════════════════
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
                            message="يبدو أن الرابط غير صحيح أو تم نقل الصفحة."), 404


@app.errorhandler(500)
def err_500(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "خطأ في الخادم"}), 500
    return render_template("error.html", code=500,
                            title="حدث خطأ",
                            message="نعتذر، حدث خطأ غير متوقع. حاول مرة أخرى."), 500


@app.errorhandler(Exception)
def err_all(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    print(f"❌ Unhandled: {e}", file=sys.stderr)
    if request.path.startswith("/api/"):
        return jsonify({"error": f"خطأ غير متوقع: {str(e)}"}), 500
    return render_template("error.html", code=500,
                            title="حدث خطأ",
                            message="نعتذر، حدث خطأ غير متوقع."), 500


# ═══════════════════════════════════════════════════════════
# تهيئة قاعدة البيانات
# ═══════════════════════════════════════════════════════════
def init_db():
    """تهيئة قاعدة البيانات مع تقرير مفصّل."""
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

                if _is_local_mode():
                    print("\n💡 نصيحة للتطوير من الهاتف:")
                    print("   • تأكد من تفعيل Public Access في Aiven")
                    print("   • استخدم hostname يبدأ بـ public-")
                    print("   • تحقق من اتصال الإنترنت")
                    print("   • جرّب: /api/db-test")
                else:
                    print("\n💡 نصيحة على Render:")
                    print("   • تحقق من متغيرات البيئة")
                    print("   • تأكد من IP Filter في Aiven")
                    print("   • جرّب: /api/db-test")

                print("═" * 60 + "\n")
                return

            print(f"✅ متصل بـ: {report['host']}:{report['port']}")
            print(f"⏱️  الاستجابة: {report['latency_ms']}ms")
            print(f"🔧 الوضع: {report['mode']}")
            if report.get("server_version"):
                print(f"📦 {report['server_version'][:60]}…")

            # إنشاء الجداول
            db.create_all()
            print("✅ الجداول جاهزة.")

            # عدّ المستخدمين والمنشورات
            try:
                users_count = User.query.count()
                posts_count = Post.query.count()
                print(f"📊 المستخدمون: {users_count} | البرومبتات: {posts_count}")
            except Exception as qerr:
                print(f"⚠️  لم نتمكن من قراءة الإحصاءات: {qerr}")

            print("═" * 60 + "\n")

        except Exception as e:
            print(f"⚠️  فشل تهيئة قاعدة البيانات: {e}", file=sys.stderr)


# استدعِ التهيئة عند الإقلاع
init_db()


# ═══════════════════════════════════════════════════════════
# التشغيل
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"

    if _is_local_mode():
        print(f"\n🚀 تشغيل خَيال محلياً على: http://localhost:{port}")
        print(f"📊 اختبار الاتصال: http://localhost:{port}/api/db-test")
        print(f"📋 حالة الجداول: http://localhost:{port}/admin/db-status\n")

    app.run(host="0.0.0.0", port=port, debug=debug)