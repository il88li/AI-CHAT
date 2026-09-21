"""
خَيال — طبقة قاعدة البيانات
PostgreSQL (Aiven) عبر SQLAlchemy.
"""
import os
import re
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def build_database_uri() -> str:
    """يبني رابط SQLAlchemy من متغيرات البيئة."""
    direct = (os.getenv("DATABASE_URL") or "").strip()
    direct = direct.replace("\n", "").replace("\r", "").replace("\t", "")

    if direct:
        direct = re.sub(r"^postgre(?:sql)?://", "postgresql://", direct, flags=re.IGNORECASE)
        direct = re.sub(r"^mysql://", "mysql+pymysql://", direct, flags=re.IGNORECASE)
        if direct.startswith("postgresql://") and "sslmode=" not in direct:
            sep = "&" if "?" in direct else "?"
            direct = f"{direct}{sep}sslmode=require"

        # إخفاء كلمة المرور من السجل
        scheme_end = direct.find("://") + 3
        at_pos = direct.find("@")
        if at_pos > 0 and scheme_end < at_pos:
            safe = direct[:scheme_end] + "***:***" + direct[at_pos:]
        else:
            safe = direct[:40] + "…"
        print(f"[DB] DATABASE_URL: {safe}")
        return direct

    host     = (os.getenv("DB_HOST") or "").strip()
    port     = (os.getenv("DB_PORT") or "").strip()
    user     = (os.getenv("DB_USER") or "").strip()
    password = (os.getenv("DB_PASSWORD") or "").strip()
    name     = (os.getenv("DB_NAME") or "defaultdb").strip()
    kind     = (os.getenv("DB_TYPE") or "postgres").lower().strip()
    use_ssl  = (os.getenv("DB_SSL") or "true").lower().strip() == "true"

    if not all([host, user, password]):
        raise RuntimeError(
            "متغيرات قاعدة البيانات ناقصة. أضف DB_HOST و DB_USER و DB_PASSWORD "
            "أو حدّد DATABASE_URL مباشرةً."
        )

    if host.startswith("pg-") and ".aivencloud.com" in host:
        print(f"⚠️  تحذير: '{host}' يبدو داخل VPC. فعّل Public Access في Aiven.")

    print(f"[DB] host={host!r} port={port!r} user={user!r} db={name!r} kind={kind}")

    if kind == "mysql":
        port = port or "3306"
        ssl_part = "&ssl_ca=ca.pem" if use_ssl else ""
        return f"mysql+pymysql://{user}:{password}@{host}:{port}/{name}?charset=utf8mb4{ssl_part}"
    else:
        port = port or "5432"
        return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}?sslmode=require"


# ═══════════════════════════════════════════════════════════
# النماذج
# ═══════════════════════════════════════════════════════════

class User(db.Model):
    __tablename__ = "users"

    id            = db.Column(db.Integer, primary_key=True)
    email         = db.Column(db.String(255), unique=True, index=True, nullable=False)
    username      = db.Column(db.String(64), unique=True, index=True, nullable=False)
    name          = db.Column(db.String(120), nullable=False)
    handle        = db.Column(db.String(64), unique=True, index=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar        = db.Column(db.String(512), nullable=True)
    bio           = db.Column(db.Text, nullable=True, default="")
    verified      = db.Column(db.Boolean, default=False)
    followers     = db.Column(db.Integer, default=0)
    following     = db.Column(db.Integer, default=0)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

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
            "username": self.username,
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
            "time": self.created_at.isoformat() if self.created_at else None,
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
            "time": self.created_at.isoformat() if self.created_at else None,
        }


class Like(db.Model):
    __tablename__ = "likes"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_like_user_post"),)

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)


class Save(db.Model):
    __tablename__ = "saves"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_save_user_post"),)

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)


class Follow(db.Model):
    __tablename__ = "follows"
    __table_args__ = (db.UniqueConstraint("follower_id", "following_id", name="uq_follow"),)

    id           = db.Column(db.Integer, primary_key=True)
    follower_id  = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    following_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


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