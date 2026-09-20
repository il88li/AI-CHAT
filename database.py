"""
خَيال — طبقة قاعدة البيانات
يدعم Aiven PostgreSQL و MySQL تلقائياً حسب متغيرات البيئة.
"""
import os
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def build_database_uri() -> str:
    """
    يبني رابط SQLAlchemy من متغيرات البيئة:
    - إن وُجد DATABASE_URL مباشرةً، استخدمه وطبّع السكيما.
    - وإلا ركّبه من DB_* مع اكتشاف النوع تلقائياً.
    """
    direct = os.getenv("DATABASE_URL")
    if direct:
        # طبّع سكيما PostgreSQL (Aiven تعطي postgres:// أحياناً)
        if direct.startswith("postgres://"):
            direct = direct.replace("postgres://", "postgresql://", 1)
        # تأكد من SSL
        if "sslmode=" not in direct and "ssl_ca=" not in direct:
            sep = "&" if "?" in direct else "?"
            direct = f"{direct}{sep}sslmode=require"
        return direct

    host = os.getenv("DB_HOST")
    port = os.getenv("DB_PORT")
    user = os.getenv("DB_USER")
    password = os.getenv("DB_PASSWORD")
    name = os.getenv("DB_NAME", "defaultdb")
    kind = (os.getenv("DB_TYPE") or "postgres").lower()
    use_ssl = os.getenv("DB_SSL", "true").lower() == "true"

    if not all([host, user, password]):
        raise RuntimeError(
            "متغيرات قاعدة البيانات ناقصة. "
            "أضف DB_HOST و DB_USER و DB_PASSWORD "
            "أو حدّد DATABASE_URL مباشرةً."
        )

    if kind == "mysql":
        port = port or "3306"
        ssl_part = "&ssl_ca=ca.pem" if use_ssl else ""
        return (
            f"mysql+pymysql://{user}:{password}@{host}:{port}/{name}"
            f"?charset=utf8mb4{ssl_part}"
        )
    else:  # postgres
        port = port or "5432"
        ssl_part = "?sslmode=require"
        return (
            f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}"
            f"{ssl_part}"
        )


# ═══════════════════════════════════════════════════════════
# النماذج (Models)
# ═══════════════════════════════════════════════════════════

class User(db.Model):
    __tablename__ = "users"

    id         = db.Column(db.Integer, primary_key=True)
    google_id  = db.Column(db.String(128), unique=True, index=True, nullable=True)
    email      = db.Column(db.String(255), unique=True, index=True, nullable=False)
    name       = db.Column(db.String(120), nullable=False)
    handle     = db.Column(db.String(64), unique=True, index=True, nullable=False)
    avatar     = db.Column(db.String(512), nullable=True)
    bio        = db.Column(db.Text, nullable=True, default="")
    verified   = db.Column(db.Boolean, default=False)
    followers  = db.Column(db.Integer, default=0)
    following  = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    posts    = db.relationship("Post", backref="author", lazy="dynamic",
                               cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="author", lazy="dynamic",
                               cascade="all, delete-orphan")
    likes    = db.relationship("Like", backref="user", lazy="dynamic",
                               cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "handle": self.handle,
            "avatar": self.avatar or f"https://api.dicebear.com/7.x/initials/svg?seed={self.name}",
            "bio": self.bio or "",
            "verified": self.verified,
            "followers": self.followers,
            "following": self.following,
        }


class Post(db.Model):
    __tablename__ = "posts"

    id         = db.Column(db.Integer, primary_key=True)
    author_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    title      = db.Column(db.String(255), nullable=False)
    prompt     = db.Column(db.Text, nullable=False)
    image      = db.Column(db.String(1024), nullable=True)
    model      = db.Column(db.String(64), nullable=True)
    tags       = db.Column(db.String(512), nullable=True)
    likes      = db.Column(db.Integer, default=0)
    copies     = db.Column(db.Integer, default=0)
    saves      = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    comments  = db.relationship("Comment", backref="post", lazy="dynamic",
                                cascade="all, delete-orphan")
    likes_rel = db.relationship("Like", backref="post", lazy="dynamic",
                                cascade="all, delete-orphan")

    @property
    def tags_list(self):
        return [t for t in (self.tags or "").split(",") if t]

    def to_dict(self):
        return {
            "id": self.id,
            "author": self.author_id,
            "title": self.title,
            "prompt": self.prompt,
            "image": self.image,
            "model": self.model,
            "tags": self.tags_list,
            "likes": self.likes,
            "copies": self.copies,
            "saves": self.saves,
            "comments": self.comments.count(),
            "time": self.created_at.isoformat(),
        }


class Comment(db.Model):
    __tablename__ = "comments"

    id         = db.Column(db.Integer, primary_key=True)
    post_id    = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    author_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=False)
    text       = db.Column(db.Text, nullable=False)
    likes      = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "author": self.author_id,
            "text": self.text,
            "likes": self.likes,
            "time": self.created_at.isoformat(),
        }


class Like(db.Model):
    __tablename__ = "likes"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_like_user_post"),)

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"),
                        nullable=False)


class Save(db.Model):
    __tablename__ = "saves"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_save_user_post"),)

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"),
                        nullable=False)


class Follow(db.Model):
    __tablename__ = "follows"
    __table_args__ = (db.UniqueConstraint("follower_id", "following_id", name="uq_follow"),)

    id           = db.Column(db.Integer, primary_key=True)
    follower_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                             nullable=False)
    following_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                             nullable=False)


class Chat(db.Model):
    __tablename__ = "chats"

    id         = db.Column(db.Integer, primary_key=True)
    user_a_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    user_b_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    messages = db.relationship("Message", backref="chat", lazy="dynamic",
                               cascade="all, delete-orphan")


class Message(db.Model):
    __tablename__ = "messages"

    id         = db.Column(db.Integer, primary_key=True)
    chat_id    = db.Column(db.Integer, db.ForeignKey("chats.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    sender_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                           nullable=False)
    text       = db.Column(db.Text, nullable=False)
    read       = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)