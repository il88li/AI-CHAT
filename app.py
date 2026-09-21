"""
خَيال — منصة البرومبتات العربية
Flask + PostgreSQL + PWA جاهز للتغليف APK
"""
import os
import sys
from datetime import datetime, timedelta
from flask import (Flask, render_template, jsonify, request, session,
                   abort, send_from_directory, make_response)
from flask_compress import Compress
from dotenv import load_dotenv

from database import (db, build_database_uri, User, Post, Comment,
                      Like, Save, Follow, Chat, Message)

load_dotenv()

# ═══════════════════════════════════════════════════════════
# إعداد التطبيق
# ═══════════════════════════════════════════════════════════
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = build_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_recycle": 280,
    "pool_size": 3,
    "max_overflow": 2,
    "connect_args": {"connect_timeout": 10, "keepalives": 1,
                     "keepalives_idle": 30, "keepalives_interval": 10},
}
app.config["COMPRESS_MIMETYPES"] = [
    "text/html", "text/css", "text/javascript",
    "application/json", "application/javascript",
    "image/svg+xml",
]
app.config["COMPRESS_LEVEL"] = 6
app.config["COMPRESS_MIN_SIZE"] = 500
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = timedelta(days=30)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

db.init_app(app)
Compress(app)


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════
def current_user():
    uid = session.get("user_id")
    return User.query.get(uid) if uid else None


def require_auth():
    u = current_user()
    if not u:
        abort(401, description="يجب تسجيل الدخول")
    return u


def _user_payload(u):
    return u.to_dict() if u else None


# ═══════════════════════════════════════════════════════════
# الصفحات
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    return render_template("index.html", me=_user_payload(current_user()))


@app.route("/app")
def app_view():
    return render_template("index.html", me=_user_payload(current_user()))


@app.route("/offline")
def offline():
    return render_template("error.html", code=503,
                            title="لا يوجد اتصال",
                            message="يبدو أنك غير متصل بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.")


# ملفات PWA
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
@app.post("/api/auth/google")
def auth_google():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    name  = (data.get("name") or "").strip()
    if not email or not name:
        return jsonify({"error": "البريد والاسم مطلوبان"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        base_handle = "@" + email.split("@")[0]
        handle = base_handle
        n = 1
        while User.query.filter_by(handle=handle).first():
            handle = f"{base_handle}{n}"
            n += 1
        user = User(
            email=email, name=name, handle=handle,
            avatar=data.get("avatar") or
                   f"https://api.dicebear.com/7.x/initials/svg?seed={name}",
            bio="", verified=False,
        )
        db.session.add(user)
        db.session.commit()

    session.permanent = True
    session["user_id"] = user.id
    return jsonify(user.to_dict())


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    return jsonify(_user_payload(current_user()))


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
        query = query.filter(Post.author_id == int(author))

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
                user_id=me.id, post_id=p.id).first() is not None
            d["saved"] = db.session.query(Save).filter_by(
                user_id=me.id, post_id=p.id).first() is not None
        else:
            d["liked"] = False
            d["saved"] = False
        out.append(d)

    resp = jsonify(out)
    if me:
        resp.headers["Cache-Control"] = "private, max-age=15"
    else:
        resp.headers["Cache-Control"] = "public, max-age=30"
    return resp


@app.get("/api/posts/<int:pid>")
def api_post(pid):
    p = Post.query.get_or_404(pid)
    d = p.to_dict()
    d["author_data"] = p.author.to_dict()
    me = current_user()
    if me:
        d["liked"] = db.session.query(Like).filter_by(
            user_id=me.id, post_id=p.id).first() is not None
        d["saved"] = db.session.query(Save).filter_by(
            user_id=me.id, post_id=p.id).first() is not None
    return jsonify(d)


@app.post("/api/posts")
def api_create_post():
    u = require_auth()
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
def api_delete_post(pid):
    u = require_auth()
    post = Post.query.get_or_404(pid)
    if post.author_id != u.id:
        abort(403)
    db.session.delete(post)
    db.session.commit()
    return jsonify({"ok": True})


@app.post("/api/posts/<int:pid>/like")
def api_like(pid):
    u = require_auth()
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
def api_save(pid):
    u = require_auth()
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
    return jsonify([{**c.to_dict(), "author_data": c.author.to_dict()}
                    for c in cs])


@app.post("/api/posts/<int:pid>/comments")
def api_add_comment(pid):
    u = require_auth()
    Post.query.get_or_404(pid)
    text = ((request.get_json() or {}).get("text") or "").strip()
    if not text:
        return jsonify({"error": "نص التعليق مطلوب"}), 400
    c = Comment(post_id=pid, author_id=u.id, text=text)
    db.session.add(c)
    db.session.commit()
    return jsonify({**c.to_dict(), "author_data": u.to_dict()}), 201


@app.delete("/api/comments/<int:cid>")
def api_delete_comment(cid):
    u = require_auth()
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
                user_id=me.id, post_id=p.id).first() is not None
            d["saved"] = db.session.query(Save).filter_by(
                user_id=me.id, post_id=p.id).first() is not None
        out.append(d)
    return jsonify(out)


@app.post("/api/users/<int:uid>/follow")
def api_follow(uid):
    me = require_auth()
    if me.id == uid:
        return jsonify({"error": "لا يمكن متابعة نفسك"}), 400
    target = User.query.get_or_404(uid)
    existing = Follow.query.filter_by(
        follower_id=me.id, following_id=uid).first()
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
def api_update_me():
    u = require_auth()
    data = request.get_json() or {}
    if "name" in data:
        u.name = (data["name"] or "").strip() or u.name
    if "bio" in data:
        u.bio = (data["bio"] or "").strip()
    if "avatar" in data and data["avatar"]:
        u.avatar = data["avatar"].strip()
    db.session.commit()
    return jsonify(u.to_dict())


# ═══════════════════════════════════════════════════════════
# الدردشة
# ═══════════════════════════════════════════════════════════
@app.get("/api/chats")
def api_chats():
    me = require_auth()
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
def api_messages(cid):
    me = require_auth()
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
def api_send_message(cid):
    me = require_auth()
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
def api_open_chat(uid):
    me = require_auth()
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
                            message="لا تملك صلاحية الوصول إلى هذا المورد."), 403


@app.errorhandler(404)
def err_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "غير موجود"}), 404
    return render_template("error.html", code=404,
                            title="الصفحة غير موجودة",
                            message="يبدو أن الرابط الذي تبحث عنه غير صحيح أو تم نقل الصفحة."), 404


@app.errorhandler(500)
def err_500(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "خطأ في الخادم"}), 500
    return render_template("error.html", code=500,
                            title="حدث خطأ",
                            message="نعتذر، حدث خطأ غير متوقع. حاول مرة أخرى بعد قليل."), 500


@app.errorhandler(Exception)
def err_all(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    print(f"❌ Unhandled: {e}", file=sys.stderr)
    if request.path.startswith("/api/"):
        return jsonify({"error": "خطأ غير متوقع"}), 500
    return render_template("error.html", code=500,
                            title="حدث خطأ",
                            message="نعتذر، حدث خطأ غير متوقع."), 500


# ═══════════════════════════════════════════════════════════
# تهيئة قاعدة البيانات
# ═══════════════════════════════════════════════════════════
def init_db():
    with app.app_context():
        try:
            db.create_all()
            print("✅ الجداول جاهزة.")
        except Exception as e:
            print("⚠️  فشل تهيئة قاعدة البيانات:", e, file=sys.stderr)


init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)