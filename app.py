"""
خَيال — منصة البرومبتات العربية
خادم Flask متصل بقاعدة بيانات Aiven عبر متغيرات البيئة.
لا توجد بيانات افتراضية — المنصة تبدأ فارغة.
"""
import os
from datetime import datetime
from flask import Flask, render_template, jsonify, request, session, abort
from dotenv import load_dotenv

from database import db, build_database_uri, User, Post, Comment, Like, Save, Follow, Chat, Message

# ═══ تحميل متغيرات البيئة من .env ═══
load_dotenv()


# ═══════════════════════════════════════════════════════════
# إعداد التطبيق
# ═══════════════════════════════════════════════════════════
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = build_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,       # تفادي الاتصالات الميتة
    "pool_recycle": 280,         # إعادة الاتصال كل 280 ثانية
    "pool_size": 5,
    "max_overflow": 2,
}

db.init_app(app)


# ═══════════════════════════════════════════════════════════
# المصادقة المبسطة (جلسة)
# ═══════════════════════════════════════════════════════════
def current_user():
    uid = session.get("user_id")
    return User.query.get(uid) if uid else None


def require_auth():
    u = current_user()
    if not u:
        abort(401, description="يجب تسجيل الدخول")
    return u


# ═══════════════════════════════════════════════════════════
# الصفحات
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    me = current_user()
    return render_template("index.html", me=me.to_dict() if me else None)


@app.route("/app")
def app_view():
    me = current_user()
    if not me:
        # غير مسجّل — افتح الصفحة الرئيسية
        return render_template("index.html", me=None)
    return render_template("index.html", me=me.to_dict(), initial_view="app")


# ═══════════════════════════════════════════════════════════
# المصادقة (Google OAuth — مبسّط)
# ═══════════════════════════════════════════════════════════
@app.post("/api/auth/google")
def auth_google():
    """
    في الإنتاج: تحقّق من الـ id_token القادم من Google.
    هنا نستقبل البريد والاسم مباشرةً للتطوير.
    """
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    name  = (data.get("name") or "").strip()
    if not email or not name:
        return jsonify({"error": "البريد والاسم مطلوبان"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        # إنشاء معرّف فريد من البريد
        base_handle = "@" + email.split("@")[0]
        handle = base_handle
        n = 1
        while User.query.filter_by(handle=handle).first():
            handle = f"{base_handle}{n}"
            n += 1
        user = User(
            email=email, name=name, handle=handle,
            avatar=data.get("avatar") or f"https://api.dicebear.com/7.x/initials/svg?seed={name}",
            bio="", verified=False,
        )
        db.session.add(user)
        db.session.commit()

    session["user_id"] = user.id
    return jsonify(user.to_dict())


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    u = current_user()
    return jsonify(u.to_dict() if u else None)


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
        query = query.filter(db.or_(Post.title.ilike(like),
                                     Post.prompt.ilike(like),
                                     Post.tags.ilike(like)))
    if tag:
        query = query.filter(Post.tags.ilike(f"%{tag}%"))
    if model:
        query = query.filter(Post.model == model)
    if author:
        query = query.filter(Post.author_id == author)

    query = query.order_by(Post.likes.desc()) if sort == "top" else query.order_by(Post.created_at.desc())
    posts = query.limit(limit).all()

    # أضف حالة الإعجاب/الحفظ للمستخدم الحالي
    me = current_user()
    result = []
    for p in posts:
        d = p.to_dict()
        d["author_data"] = p.author.to_dict()
        if me:
            d["liked"] = db.session.query(Like).filter_by(user_id=me.id, post_id=p.id).first() is not None
            d["saved"] = db.session.query(Save).filter_by(user_id=me.id, post_id=p.id).first() is not None
        result.append(d)
    return jsonify(result)


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
    return jsonify(post.to_dict()), 201


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


@app.get("/api/posts/<int:pid>/comments")
def api_comments(pid):
    Post.query.get_or_404(pid)
    comments = Comment.query.filter_by(post_id=pid).order_by(Comment.created_at.desc()).all()
    return jsonify([{**c.to_dict(), "author_data": c.author.to_dict()} for c in comments])


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


# ═══════════════════════════════════════════════════════════
# المستخدمون
# ═══════════════════════════════════════════════════════════
@app.get("/api/users/<int:uid>")
def api_user(uid):
    u = User.query.get_or_404(uid)
    return jsonify(u.to_dict())


@app.post("/api/users/<int:uid>/follow")
def api_follow(uid):
    me = require_auth()
    if me.id == uid:
        return jsonify({"error": "لا يمكن متابعة نفسك"}), 400
    target = User.query.get_or_404(uid)
    existing = Follow.query.filter_by(follower_id=me.id, following_id=uid).first()
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
    return jsonify({"following": following})


# ═══════════════════════════════════════════════════════════
# الدردشة
# ═══════════════════════════════════════════════════════════
@app.get("/api/chats")
def api_chats():
    me = require_auth()
    chats = Chat.query.filter(db.or_(Chat.user_a_id == me.id, Chat.user_b_id == me.id)).all()
    out = []
    for c in chats:
        other_id = c.user_b_id if c.user_a_id == me.id else c.user_a_id
        other = User.query.get(other_id)
        last = c.messages.order_by(Message.created_at.desc()).first()
        out.append({
            "id": c.id,
            "with_user": other.to_dict() if other else None,
            "last": last.text if last else "",
            "time": last.created_at.strftime("%Y-%m-%d") if last else "",
            "unread": c.messages.filter_by(read=False).filter(Message.sender_id != me.id).count(),
        })
    return jsonify(out)


@app.get("/api/chats/<int:cid>/messages")
def api_messages(cid):
    me = require_auth()
    chat = Chat.query.get_or_404(cid)
    if me.id not in (chat.user_a_id, chat.user_b_id):
        abort(403)
    msgs = chat.messages.order_by(Message.created_at.asc()).all()
    # علّم الرسائل كمقروءة
    for m in msgs:
        if m.sender_id != me.id and not m.read:
            m.read = True
    db.session.commit()
    return jsonify([{
        "id": m.id, "text": m.text,
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
    return jsonify({"id": m.id, "text": m.text, "from": "me",
                    "time": m.created_at.strftime("%H:%M")}), 201


@app.post("/api/chats/with/<int:uid>")
def api_open_chat(uid):
    """يفتح محادثة مع مستخدم أو ينشئها."""
    me = require_auth()
    if me.id == uid:
        abort(400)
    chat = Chat.query.filter(
        db.or_(
            db.and_(Chat.user_a_id == me.id, Chat.user_b_id == uid),
            db.and_(Chat.user_a_id == uid, Chat.user_b_id == me.id),
        )
    ).first()
    if not chat:
        chat = Chat(user_a_id=me.id, user_b_id=uid)
        db.session.add(chat)
        db.session.commit()
    return jsonify({"id": chat.id})


# ═══════════════════════════════════════════════════════════
# الصحة والإقلاع
# ═══════════════════════════════════════════════════════════
@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "db": "connected",
        "users": User.query.count(),
        "posts": Post.query.count(),
    })


# ═══════════════════════════════════════════════════════════
# إنشاء الجداول عند أول تشغيل
# ═══════════════════════════════════════════════════════════
with app.app_context():
    try:
        db.create_all()
        print("✅ الجداول جاهزة في قاعدة البيانات.")
    except Exception as e:
        print("⚠️ فشل الاتصال بقاعدة البيانات:", e)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)