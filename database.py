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