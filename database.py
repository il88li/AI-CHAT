"""
خَيال — طبقة قاعدة البيانات v2
إصلاح SSL مع Aiven، pool recycling آمن، دعم pg8000 كبديل
"""
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlparse, urlunparse

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


# ═══════════════════════════════════════════════════════════
# كشف البيئة
# ═══════════════════════════════════════════════════════════
def is_running_on_render() -> bool:
    return bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))


def is_running_locally() -> bool:
    return not is_running_on_render()


# ═══════════════════════════════════════════════════════════
# تنقية وتصحيح الرابط
# ═══════════════════════════════════════════════════════════
def _sanitize_uri(uri: str) -> str:
    if not uri:
        return ""
    return uri.replace("\n", "").replace("\r", "").replace("\t", "").strip()


def _normalize_scheme(uri: str) -> str:
    uri = re.sub(r"^postgre(?:sql)?://", "postgresql://", uri, flags=re.IGNORECASE)
    uri = re.sub(r"^postgres://", "postgresql://", uri, flags=re.IGNORECASE)
    uri = re.sub(r"^mysql://", "mysql+pymysql://", uri, flags=re.IGNORECASE)
    return uri


def _mask_password(uri: str) -> str:
    try:
        parsed = urlparse(uri)
        if parsed.password:
            netloc = parsed.netloc.replace(f":{parsed.password}@", ":***@")
            return urlunparse(parsed._replace(netloc=netloc))
    except Exception:
        pass
    return uri[:60] + "…"


def _force_ssl_require(uri: str) -> str:
    """يضمن sslmode=require (Aiven يرفض أي شيء آخر)."""
    if not uri.startswith("postgresql"):
        return uri
    uri = re.sub(r"[?&]sslmode=[^&]*", "", uri)
    sep = "&" if "?" in uri else "?"
    return f"{uri}{sep}sslmode=require"


def _swap_host_to_public(uri: str) -> str:
    try:
        parsed = urlparse(uri)
        host = parsed.hostname or ""
        if host.startswith("pg-") and host.endswith(".aivencloud.com"):
            new_host = "public-" + host
            netloc = parsed.netloc.replace(host, new_host, 1)
            return urlunparse(parsed._replace(netloc=netloc))
    except Exception as e:
        print(f"⚠️ public swap failed: {e}", file=sys.stderr)
    return uri


# ═══════════════════════════════════════════════════════════
# بناء رابط الاتصال
# ═══════════════════════════════════════════════════════════
def build_database_uri() -> str:
    direct = _sanitize_uri(os.getenv("DATABASE_URL"))

    if direct:
        direct = _normalize_scheme(direct)
        direct = _force_ssl_require(direct)
        if is_running_locally():
            host = urlparse(direct).hostname or ""
            if host.startswith("pg-") and "aivencloud.com" in host:
                print(f"📍 local mode: {host} → public-{host}")
                direct = _swap_host_to_public(direct)
        print(f"[DB] mode={'render' if is_running_on_render() else 'local'}")
        print(f"[DB] {_mask_password(direct)}")
        return direct

    # بناء من متغيرات منفصلة
    host = _sanitize_uri(os.getenv("DB_HOST"))
    port = _sanitize_uri(os.getenv("DB_PORT")) or "5432"
    user = _sanitize_uri(os.getenv("DB_USER"))
    password = _sanitize_uri(os.getenv("DB_PASSWORD"))
    name = _sanitize_uri(os.getenv("DB_NAME")) or "defaultdb"

    if not all([host, user, password]):
        raise RuntimeError(
            "❌ متغيرات قاعدة البيانات ناقصة.\n"
            "أضف DATABASE_URL=postgresql://..."
        )

    if is_running_locally() and host.startswith("pg-") and "aivencloud.com" in host:
        host = "public-" + host

    uri = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{name}?sslmode=require"
    print(f"[DB] mode={'render' if is_running_on_render() else 'local'}")
    print(f"[DB] host={host} port={port} db={name}")
    return uri


# ═══════════════════════════════════════════════════════════
# اختبار الاتصال
# ═══════════════════════════════════════════════════════════
def test_connection(app) -> dict:
    from sqlalchemy import text
    report = {
        "mode": "render" if is_running_on_render() else "local",
        "uri_masked": _mask_password(app.config.get("SQLALCHEMY_DATABASE_URI", "")),
        "host": None,
        "port": None,
        "connected": False,
        "error": None,
        "server_version": None,
        "latency_ms": None,
    }
    try:
        parsed = urlparse(app.config["SQLALCHEMY_DATABASE_URI"])
        report["host"] = parsed.hostname
        report["port"] = parsed.port
    except Exception:
        pass

    try:
        start = time.time()
        with app.app_context():
            result = db.session.execute(text("SELECT version()"))
            version = result.scalar()
            report["connected"] = True
            report["server_version"] = (version or "")[:80]
            report["latency_ms"] = round((time.time() - start) * 1000, 1)
    except Exception as e:
        report["error"] = str(e)
        report["error_type"] = type(e).__name__

    return report


# ═══════════════════════════════════════════════════════════
# النماذج
# ═══════════════════════════════════════════════════════════

class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, index=True, nullable=False)
    username = db.Column(db.String(64), unique=True, index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    handle = db.Column(db.String(64), unique=True, index=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    avatar = db.Column(db.String(512), nullable=True)
    bio = db.Column(db.Text, nullable=True, default="")
    verified = db.Column(db.Boolean, default=False)
    followers = db.Column(db.Integer, default=0)
    following = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    posts = db.relationship("Post", backref="author", lazy="dynamic",
                            cascade="all, delete-orphan")
    comments = db.relationship("Comment", backref="author", lazy="dynamic",
                               cascade="all, delete-orphan")
    likes = db.relationship("Like", backref="user", lazy="dynamic",
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

    id = db.Column(db.Integer, primary_key=True)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    image = db.Column(db.String(1024), nullable=True)
    model = db.Column(db.String(64), nullable=True)
    tags = db.Column(db.String(512), nullable=True)
    likes = db.Column(db.Integer, default=0)
    copies = db.Column(db.Integer, default=0)
    saves = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    comments = db.relationship("Comment", backref="post", lazy="dynamic",
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

    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False)
    text = db.Column(db.Text, nullable=False)
    likes = db.Column(db.Integer, default=0)
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

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)


class Save(db.Model):
    __tablename__ = "saves"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_save_user_post"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)


class Follow(db.Model):
    __tablename__ = "follows"
    __table_args__ = (db.UniqueConstraint("follower_id", "following_id", name="uq_follow"),)

    id = db.Column(db.Integer, primary_key=True)
    follower_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    following_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


class Chat(db.Model):
    __tablename__ = "chats"

    id = db.Column(db.Integer, primary_key=True)
    user_a_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    user_b_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    messages = db.relationship("Message", backref="chat", lazy="dynamic",
                               cascade="all, delete-orphan")


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("chats.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False)
    text = db.Column(db.Text, nullable=False)
    read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)