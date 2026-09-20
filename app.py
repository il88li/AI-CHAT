"""
خَيال — منصة البرومبتات العربية
خادم Flask: يخدم القالب + يوفر REST API جاهز للتوسعة لاحقاً.
"""
from flask import Flask, render_template, jsonify, request, abort
from datetime import datetime
import random

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False


# ═══════════════════════════════════════════════════════════
# DATA STORE — للاستبدال بقاعدة بيانات حقيقية لاحقاً
# ═══════════════════════════════════════════════════════════
USERS = {
    "u1": {"id":"u1","name":"ميّادة التونسي","handle":"@mayada.t",
           "avatar":"https://picsum.photos/seed/user_maya/160/160",
           "bio":"مخرجة فنية للذكاء الاصطناعي من تونس. أعمل مع الضوء والحبيبات.",
           "followers":4820,"following":210,"verified":True},
    "u2": {"id":"u2","name":"كريم الحربي","handle":"@karim.h",
           "avatar":"https://picsum.photos/seed/user_karim/160/160",
           "bio":"مصور تحوّل إلى هندسة البرومبتات. الرياض.",
           "followers":2310,"following":88,"verified":False},
    "u3": {"id":"u3","name":"ليلى العباسي","handle":"@layla.a",
           "avatar":"https://picsum.photos/seed/user_layla/160/160",
           "bio":"مصممة منتجات. أصنع صوراً ثلاثية الأبعاد هادئة.",
           "followers":6120,"following":340,"verified":True},
    "u4": {"id":"u4","name":"يوسف بن عيسى","handle":"@youssef.b",
           "avatar":"https://picsum.photos/seed/user_youssef/160/160",
           "bio":"سايبربانك وخيال علمي. الدار البيضاء. أنشر كل برومبت.",
           "followers":1890,"following":145,"verified":False},
    "me": {"id":"me","name":"أنت","handle":"@you",
           "avatar":"https://picsum.photos/seed/user_me/160/160",
           "bio":"مبدع صور بالذكاء الاصطناعي. أنشر البرومبت في كل مرة.",
           "followers":248,"following":112,"verified":True},
}

MODELS = ["Midjourney v6","DALL·E 3","Stable Diffusion XL","Flux 1.1 Pro","Adobe Firefly"]

POSTS = [
    {"id":"p1","author":"u1","title":"بورتريه على سطح طوكيو النيوني",
     "prompt":"Cinematic portrait of a woman standing on a Tokyo rooftop at night, neon signs reflecting on wet pavement, shallow depth of field, 85mm lens f/1.4, cyberpunk color grade with teal and magenta, subtle film grain --ar 3:4 --v 6",
     "image":"https://picsum.photos/seed/tokyo7/900/1200","model":"Midjourney v6",
     "tags":["بورتريه","سايبربانك","سينمائي"],"likes":248,"copies":91,"saves":34,
     "liked":False,"saved":False,"comments":4,"time":"قبل ساعتين"},
    {"id":"p2","author":"u2","title":"زقاق كيوتو تحت المطر",
     "prompt":"Quiet Kyoto alley in the rain at dusk, wet stone pavement reflecting warm lantern light, muted teal and amber palette, 35mm film look, Kodak Portra 400, misty atmosphere",
     "image":"https://picsum.photos/seed/kyoto3/1200/900","model":"DALL·E 3",
     "tags":["مناظر","تصوير","مطر"],"likes":412,"copies":156,"saves":78,
     "liked":True,"saved":True,"comments":8,"time":"قبل 5 ساعات"},
    {"id":"p3","author":"u3","title":"مزهرية سيراميك — دراسة بسيطة",
     "prompt":"Minimalist product photography of a matte ceramic vase in bone white, placed on beige linen, soft diffused daylight from a large window, muted earth tones, 50mm f/4",
     "image":"https://picsum.photos/seed/vase9/900/1200","model":"Stable Diffusion XL",
     "tags":["ثلاثي الأبعاد","بسيط","منتج"],"likes":187,"copies":62,"saves":22,
     "liked":False,"saved":False,"comments":3,"time":"قبل 8 ساعات"},
    {"id":"p4","author":"u4","title":"بائع طعام في سوق سايبربانك",
     "prompt":"Futuristic street food vendor in crowded cyberpunk market at night, holographic signage, steam rising from grill, rain, neon pink and cyan, cinematic wide, Blade Runner aesthetic, 24mm --ar 16:9 --v 6",
     "image":"https://picsum.photos/seed/cyber11/1200/800","model":"Midjourney v6",
     "tags":["سايبربانك","خيال علمي","مدينة"],"likes":892,"copies":341,"saves":156,
     "liked":False,"saved":True,"comments":12,"time":"قبل 12 ساعة"},
    {"id":"p5","author":"u1","title":"بورتريه صباحي هادئ",
     "prompt":"Intimate portrait of a person waking up, soft morning light through sheer curtains, warm skin tones, film grain, 50mm f/2, natural window light, muted peachy palette --ar 4:5",
     "image":"https://picsum.photos/seed/morning5/900/1125","model":"Flux 1.1 Pro",
     "tags":["بورتريه","صباح","فيلم"],"likes":324,"copies":118,"saves":61,
     "liked":False,"saved":False,"comments":5,"time":"قبل يوم"},
    {"id":"p6","author":"u3","title":"مرصد في قلب الصحراء ليلاً",
     "prompt":"A solitary observatory dome in the middle of vast desert at night, milky way overhead, long exposure star trails, deep blue and sand palette, wide angle 14mm f/2.8, cinematic --ar 3:2",
     "image":"https://picsum.photos/seed/desert2/1200/800","model":"Midjourney v6",
     "tags":["مناظر","فضاء","ليل"],"likes":567,"copies":203,"saves":128,
     "liked":True,"saved":False,"comments":7,"time":"قبل يوم"},
    {"id":"p7","author":"u2","title":"بورتريه فيلمي، الساعة الذهبية",
     "prompt":"Analog film portrait of a young man at golden hour, backlit, sun flare across the frame, warm amber tones, Kodak Gold 200, 85mm f/1.8, natural bokeh --ar 4:5",
     "image":"https://picsum.photos/seed/analog8/900/1125","model":"DALL·E 3",
     "tags":["بورتريه","فيلم","الساعة الذهبية"],"likes":401,"copies":137,"saves":82,
     "liked":False,"saved":False,"comments":6,"time":"قبل يومين"},
    {"id":"p8","author":"u4","title":"مكتبة بأسلوب الوحشية",
     "prompt":"Interior of a brutalist concrete library, tall vertical windows casting geometric shadows, single figure reading at long wooden table, warm afternoon light, 24mm tilt-shift",
     "image":"https://picsum.photos/seed/brutal4/1200/800","model":"Stable Diffusion XL",
     "tags":["معمار","بسيط","ضوء"],"likes":233,"copies":84,"saves":45,
     "liked":False,"saved":False,"comments":2,"time":"قبل يومين"},
]

COMMENTS = {
    "p1": [
        {"id":"c1","author":"u2","text":"الإضاءة الجانبية هنا مذهلة. هل استخدمت controlnet؟","time":"قبل ساعة","likes":12},
        {"id":"c2","author":"u3","text":"أعدت استخدامه — النتيجة أفضل مما توقعت. شكراً!","time":"قبل ٤٠ دقيقة","likes":8},
        {"id":"c3","author":"u4","text":"-style raw يفرق كثير في Midjourney. جرّب v6.1","time":"قبل ٢٠ دقيقة","likes":5},
        {"id":"c4","author":"u1","text":"شكراً للجميع! سأنشر نسخة بـ v6.1 قريباً.","time":"قبل ١٠ دقائق","likes":15},
    ],
    "p2": [
        {"id":"c5","author":"u1","text":"مرجع Portra 400 هو السر. جميل جداً.","time":"قبل ٣ ساعات","likes":22},
        {"id":"c6","author":"u3","text":"أريد تجربته في مشهد نهاري أيضاً.","time":"قبل ٢ ساعات","likes":7},
    ],
}

CHATS = [
    {"id":"c1","with_user":"u1","unread":True,"messages":[
        {"from":"them","text":"أهلاً! أحببت برومبت زقاق كيوتو. هل عدّلت الألوان لاحقاً؟","time":"١٠:٢٤"},
        {"from":"me","text":"من الموديل مباشرة — شدّدت على muted teal and amber palette.","time":"١٠:٣١"},
        {"from":"them","text":"ممتاز. سأجربه بمرجع Fuji Superia.","time":"١٠:٣٣"},
        {"from":"them","text":"وهذا آخر ما نشرته إن أردت إعادة استخدامه.","time":"١٠:٣٤","share":"p1"},
    ]},
    {"id":"c2","with_user":"u3","unread":True,"messages":[
        {"from":"them","text":"ليلى هنا — رأيت إعجابك بدراسة المزهرية. تريد البرومبت السلبي؟","time":"أمس"},
        {"from":"me","text":"نعم من فضلك! لم أستطع الحصول على ظلال بهذا النعومة.","time":"أمس"},
    ]},
    {"id":"c3","with_user":"u4","unread":False,"messages":[
        {"from":"them","text":"برومبت سوق السايبربانك جلب 4 آلاف إعجاب. شكراً!","time":"الاثنين"},
        {"from":"me","text":"سعيد أنه نجح! اللقطة الواسعة 24mm هي السر.","time":"الاثنين"},
    ]},
]

NOTIFICATIONS = [
    {"id":"n1","type":"like","user":"u2","text":"أعجب ببرومبتك «بورتريه صباحي هادئ»","time":"قبل ٥ دقائق","unread":True,"post":"p5"},
    {"id":"n2","type":"follow","user":"u3","text":"بدأت بمتابعتك","time":"قبل ٢٠ دقيقة","unread":True,"post":None},
    {"id":"n3","type":"comment","user":"u4","text":"علّق على «مرصد في قلب الصحراء»","time":"قبل ساعة","unread":True,"post":"p6"},
    {"id":"n4","type":"copy","user":"u1","text":"نسخ برومبت «زقاق كيوتو»","time":"قبل ٣ ساعات","unread":False,"post":"p2"},
    {"id":"n5","type":"like","user":"u3","text":"أعجبت ببرومبتك «بورتريه طوكيو»","time":"قبل يوم","unread":False,"post":"p1"},
]


# ═══════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════
def find_post(pid):
    return next((p for p in POSTS if p["id"] == pid), None)


# ═══════════════════════════════════════════════════════════
# VIEWS
# ═══════════════════════════════════════════════════════════
@app.route("/")
def index():
    """الصفحة الواحدة — تحتوي على القالب الكامل مع كل البيانات المحقونة."""
    return render_template("index.html", data={
        "users": USERS,
        "posts": POSTS,
        "models": MODELS,
        "comments": COMMENTS,
        "chats": CHATS,
        "notifications": NOTIFICATIONS,
        "current_user": USERS["me"],
    })


@app.route("/app")
def app_view():
    """نفس القالب — الواجهة تقرّر أيّ قسم تعرضه بناءً على المسار."""
    return render_template("index.html", data={
        "users": USERS,
        "posts": POSTS,
        "models": MODELS,
        "comments": COMMENTS,
        "chats": CHATS,
        "notifications": NOTIFICATIONS,
        "current_user": USERS["me"],
        "initial_view": "app",
    })


# ═══════════════════════════════════════════════════════════
# REST API — جاهز للاستخدام من الواجهة الأمامية
# ═══════════════════════════════════════════════════════════
@app.get("/api/posts")
def api_posts():
    tag = request.args.get("tag")
    model = request.args.get("model")
    author = request.args.get("author")
    sort = request.args.get("sort", "recent")
    items = POSTS
    if tag:
        items = [p for p in items if tag in p["tags"]]
    if model:
        items = [p for p in items if p["model"] == model]
    if author:
        items = [p for p in items if p["author"] == author]
    if sort == "top":
        items = sorted(items, key=lambda p: p["likes"], reverse=True)
    return jsonify(items)


@app.get("/api/posts/<pid>")
def api_post(pid):
    p = find_post(pid) or abort(404)
    return jsonify(p)


@app.post("/api/posts/<pid>/like")
def api_like(pid):
    p = find_post(pid) or abort(404)
    p["liked"] = not p["liked"]
    p["likes"] += 1 if p["liked"] else -1
    return jsonify({"liked": p["liked"], "likes": p["likes"]})


@app.post("/api/posts/<pid>/save")
def api_save(pid):
    p = find_post(pid) or abort(404)
    p["saved"] = not p["saved"]
    p["saves"] += 1 if p["saved"] else -1
    return jsonify({"saved": p["saved"], "saves": p["saves"]})


@app.post("/api/posts/<pid>/copy")
def api_copy(pid):
    p = find_post(pid) or abort(404)
    p["copies"] += 1
    return jsonify({"copies": p["copies"]})


@app.get("/api/posts/<pid>/comments")
def api_comments(pid):
    return jsonify(COMMENTS.get(pid, []))


@app.post("/api/posts/<pid>/comments")
def api_add_comment(pid):
    if not find_post(pid):
        abort(404)
    body = request.get_json() or {}
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify({"error": "نص التعليق مطلوب"}), 400
    c = {
        "id": f"c{random.randint(1000, 9999)}",
        "author": "me",
        "text": text,
        "time": "الآن",
        "likes": 0,
    }
    COMMENTS.setdefault(pid, []).append(c)
    return jsonify(c), 201


@app.get("/api/users/<uid>")
def api_user(uid):
    return jsonify(USERS.get(uid) or abort(404))


@app.get("/api/notifications")
def api_notifications():
    return jsonify(NOTIFICATIONS)


@app.get("/api/chats")
def api_chats():
    return jsonify(CHATS)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "posts": len(POSTS), "users": len(USERS)})


# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)