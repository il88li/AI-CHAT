"""
خَيال — طبقة قاعدة البيانات v11.0
- PostgreSQL + MySQL + SSL لـ Aiven
- إطارات صور شخصية (8 أنواع) + أغلفة موسّعة (12 نمطاً)
- pronouns محصور بقائمة محددة مسبقاً
- location و status محفوظان للأرشيف فقط (لا يُستخدمان في الواجهة)
"""
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urlparse, urlunparse

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def is_running_on_render() -> bool:
    return bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))


def is_running_locally() -> bool:
    return not is_running_on_render()


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


def build_database_uri() -> str:
    direct = _sanitize_uri(os.getenv("DATABASE_URL"))
    if direct:
        direct = _normalize_scheme(direct)
        direct = _force_ssl_require(direct)
        if is_running_locally():
            host = urlparse(direct).hostname or ""
            if host.startswith("pg-") and "aivencloud.com" in host:
                direct = _swap_host_to_public(direct)
        print(f"[DB] mode={'render' if is_running_on_render() else 'local'}")
        print(f"[DB] {_mask_password(direct)}")
        return direct

    host = _sanitize_uri(os.getenv("DB_HOST"))
    port = _sanitize_uri(os.getenv("DB_PORT")) or "5432"
    user = _sanitize_uri(os.getenv("DB_USER"))
    password = _sanitize_uri(os.getenv("DB_PASSWORD"))
    name = _sanitize_uri(os.getenv("DB_NAME")) or "defaultdb"
    kind = (_sanitize_uri(os.getenv("DB_TYPE")) or "postgres").lower()

    if not all([host, user, password]):
        raise RuntimeError("❌ متغيرات قاعدة البيانات ناقصة.")

    if is_running_locally() and host.startswith("pg-") and "aivencloud.com" in host:
        host = "public-" + host

    if kind == "mysql":
        uri = f"mysql+pymysql://{user}:{password}@{host}:{port or '3306'}/{name}?charset=utf8mb4"
    else:
        uri = f"postgresql+psycopg2://{user}:{password}@{host}:{port or '5432'}/{name}?sslmode=require"
    print(f"[DB] host={host} port={port} db={name}")
    return uri


def test_connection(app) -> dict:
    from sqlalchemy import text
    report = {
        "mode": "render" if is_running_on_render() else "local",
        "uri_masked": _mask_password(app.config.get("SQLALCHEMY_DATABASE_URI", "")),
        "host": None, "port": None,
        "connected": False, "error": None,
        "server_version": None, "latency_ms": None,
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
            report["server_version"] = (result.scalar() or "")[:80]
            report["connected"] = True
            report["latency_ms"] = round((time.time() - start) * 1000, 1)
    except Exception as e:
        report["error"] = str(e)
        report["error_type"] = type(e).__name__
    return report


# ═══════════════════════════════════════════════════════════
# الثوابت المشتركة (Whitelist)
# ═══════════════════════════════════════════════════════════
ALLOWED_COVERS = {
    "aurora", "sunset", "forest", "royal", "midnight", "ocean",
    "cyber", "candy", "mesh", "noir", "topo", "dots",
}

ALLOWED_FRAMES = {
    "none", "ring", "gradient", "neon",
    "double", "polaroid", "glass", "hex",
}

ALLOWED_PRONOUNS = {"", "هو", "هي", "هم", "هن"}

ALLOWED_CARD_STYLES = {"glass", "solid", "gradient"}


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

    # Basic
    avatar = db.Column(db.String(512), nullable=True)
    bio = db.Column(db.Text, nullable=True, default="")

    # Profile metadata (v11)
    website = db.Column(db.String(120), nullable=True)
    pronouns = db.Column(db.String(20), nullable=True)
    # أرشيف فقط — لا تظهر في الواجهة بعد v11
    location = db.Column(db.String(60), nullable=True)
    status = db.Column(db.String(100), nullable=True)

    # Visual customization (v11)
    cover = db.Column(db.String(40), nullable=True, default="aurora")
    accent_color = db.Column(db.String(7), nullable=True, default="#22D3EE")
    avatar_shape = db.Column(db.String(30), nullable=True, default="ring")  # frame type
    card_style = db.Column(db.String(12), nullable=True, default="glass")

    # Stats
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
            "website": self.website,
            "pronouns": self.pronouns,
            "cover": self.cover or "aurora",
            "accent_color": self.accent_color or "#22D3EE",
            "avatar_shape": self.avatar_shape or "ring",
            "card_style": self.card_style or "glass",
            "verified": self.verified,
            "followers": self.followers,
            "following": self.following,
            "created_at": self.created_at.isoformat() if self.created_at else None,
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
            "id": self.id, "author": self.author_id,
            "title": self.title, "prompt": self.prompt,
            "image": self.image, "model": self.model,
            "tags": self.tags_list,
            "likes": self.likes, "copies": self.copies, "saves": self.saves,
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
            "id": self.id, "author": self.author_id,
            "text": self.text, "likes": self.likes,
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