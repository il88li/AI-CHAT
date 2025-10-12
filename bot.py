import asyncio
import json
import os
import httpx
import re
import logging
from datetime import datetime
from pyrogram import Client, filters
from pyrogram.types import (
    InlineKeyboardMarkup, 
    InlineKeyboardButton,
    Message,
    CallbackQuery
)
from pyrogram.enums import ParseMode, ChatMemberStatus

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Bot configuration
API_ID = 23656977
API_HASH = "49d3f43531a92b3f5bc403766313ca1e"
BOT_TOKEN = "8052900952:AAFTioRqhxF7Tby2ISWEjSB8dX4cWwqNXAk"

# Channels
MANDATORY_CHANNEL = "iIl337"
ADMIN_USERNAME = "OlIiIl7"
SERVICE_CHANNEL = "+42777"

# Admin ID
ADMIN_ID = 6689435577

# Initialize bot
app = Client("customer_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

# File-based storage system
class FileStorage:
    def __init__(self):
        self.data_dir = "data"
        self.ensure_data_dir()
    
    def ensure_data_dir(self):
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
    
    def get_file_path(self, filename):
        return os.path.join(self.data_dir, f"{filename}.json")
    
    def read_json(self, filename, default=None):
        try:
            file_path = self.get_file_path(filename)
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return default if default is not None else {}
        except Exception as e:
            logger.error(f"Error reading {filename}: {e}")
            return default if default is not None else {}
    
    def write_json(self, filename, data):
        try:
            file_path = self.get_file_path(filename)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            logger.error(f"Error writing {filename}: {e}")
            return False
    
    # Users operations
    def get_user(self, user_id):
        users = self.read_json("users", {})
        return users.get(str(user_id))
    
    def save_user(self, user_id, user_data):
        users = self.read_json("users", {})
        users[str(user_id)] = user_data
        return self.write_json("users", users)
    
    def update_user(self, user_id, updates):
        users = self.read_json("users", {})
        user_id_str = str(user_id)
        if user_id_str not in users:
            users[user_id_str] = {}
        users[user_id_str].update(updates)
        return self.write_json("users", users)
    
    def delete_user(self, user_id):
        users = self.read_json("users", {})
        if str(user_id) in users:
            del users[str(user_id)]
            return self.write_json("users", users)
        return True
    
    def get_all_users(self):
        return self.read_json("users", {})
    
    # Referrals operations
    def get_referrals(self):
        return self.read_json("referrals", [])
    
    def add_referral(self, referrer_id, referred_id):
        referrals = self.get_referrals()
        referrals.append({
            "referrer_id": referrer_id,
            "referred_id": referred_id,
            "subscribed": False,
            "created_at": datetime.now().isoformat()
        })
        return self.write_json("referrals", referrals)
    
    def update_referral_subscription(self, referred_id):
        referrals = self.get_referrals()
        for referral in referrals:
            if referral["referred_id"] == referred_id:
                referral["subscribed"] = True
                break
        return self.write_json("referrals", referrals)
    
    # User states operations
    def get_user_state(self, user_id):
        states = self.read_json("user_states", {})
        state_data = states.get(str(user_id), {})
        return state_data.get("state"), state_data.get("data")
    
    def set_user_state(self, user_id, state, data=""):
        states = self.read_json("user_states", {})
        states[str(user_id)] = {"state": state, "data": data}
        return self.write_json("user_states", states)
    
    def clear_user_state(self, user_id):
        states = self.read_json("user_states", {})
        if str(user_id) in states:
            del states[str(user_id)]
            return self.write_json("user_states", states)
        return True
    
    # User channels operations
    def get_user_channels(self, user_id):
        channels = self.read_json("user_channels", {})
        return channels.get(str(user_id), [])
    
    def add_user_channel(self, user_id, channel_data):
        channels = self.read_json("user_channels", {})
        user_id_str = str(user_id)
        if user_id_str not in channels:
            channels[user_id_str] = []
        channels[user_id_str].append(channel_data)
        return self.write_json("user_channels", channels)

# Initialize storage
storage = FileStorage()

# User session management
class UserSessionManager:
    def __init__(self):
        self.active_sessions = {}
    
    async def create_user_session(self, user_id, phone, session_string):
        try:
            client = Client(f"user_{user_id}", api_id=API_ID, api_hash=API_HASH, session_string=session_string)
            await client.start()
            self.active_sessions[user_id] = {
                'client': client,
                'phone': phone,
                'is_online': True
            }
            return True
        except Exception as e:
            logger.error(f"Error creating session for user {user_id}: {e}")
            return False
    
    async def stop_user_session(self, user_id):
        if user_id in self.active_sessions:
            try:
                await self.active_sessions[user_id]['client'].stop()
                del self.active_sessions[user_id]
            except Exception as e:
                logger.error(f"Error stopping session for user {user_id}: {e}")
    
    def is_user_online(self, user_id):
        return user_id in self.active_sessions and self.active_sessions[user_id]['is_online']

session_manager = UserSessionManager()

# DeepSeek AI function - باستخدام httpx بدل aiohttp
async def get_ai_response(message_text: str) -> str:
    try:
        # Clean message text for URL
        clean_text = re.sub(r'[^\w\s\u0600-\u06FF]', '', message_text)
        clean_text = clean_text.replace(' ', '+')
        
        url = f"https://sii3.top/api/deepseek.php?v3={clean_text}"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, timeout=10.0)
            result = response.text
            
            # Clean response from code and special characters
            clean_result = re.sub(r'[^\w\s\u0600-\u06FF\.,!?\-]', '', result)
            clean_result = re.sub(r'\s+', ' ', clean_result).strip()
            
            # Limit to few words
            words = clean_result.split()[:15]
            return ' '.join(words) if words else "أهلاً بك! كيف يمكنني مساعدتك؟"
            
    except Exception as e:
        logger.error(f"AI API error: {e}")
        return "عذراً، حدث خطأ في النظام."

# Check subscription
async def check_subscription(user_id: int) -> bool:
    try:
        user = await app.get_chat_member(MANDATORY_CHANNEL, user_id)
        return user.status in [ChatMemberStatus.MEMBER, ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER]
    except Exception as e:
        logger.error(f"Subscription check error: {e}")
        return False

# Check if user is VIP
def is_vip(user_id: int) -> bool:
    user = storage.get_user(user_id)
    return user and user.get("vip", False)

# Get user invite count
def get_invite_count(user_id: int) -> int:
    referrals = storage.get_referrals()
    count = 0
    for referral in referrals:
        if referral["referrer_id"] == user_id and referral.get("subscribed", False):
            count += 1
    return count

# Generate referral link
def generate_referral_link(user_id: int) -> str:
    return f"https://t.me/TRNZ7_BOT?start=ref_{user_id}"

# Initialize default user data
def get_default_user_data():
    return {
        "phone": "",
        "session_string": "",
        "bio": "",
        "auto_reply": False,
        "vip": False,
        "invited_by": None,
        "invited_count": 0,
        "banned": False,
        "created_at": datetime.now().isoformat()
    }

# Main menu
def get_main_menu(user_id: int, auto_reply_status: bool = False):
    ai_button_text = "انقر لإيقاف AI" if auto_reply_status else "انقر لتشغيل AI"
    
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("التحكم بالجلسة", callback_data="session_control")],
        [InlineKeyboardButton(ai_button_text, callback_data="toggle_ai")],
    ])

# Session control menu
def get_session_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تسجيل حسابك", callback_data="register_account")],
        [InlineKeyboardButton("تعيين النبذة", callback_data="set_bio")],
        [InlineKeyboardButton("إحصائيات", callback_data="statistics")],
        [InlineKeyboardButton("حذف الجلسة", callback_data="delete_session")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_main")]
    ])

# Admin menu
def get_admin_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("إدارة العضويات", callback_data="manage_membership")],
        [InlineKeyboardButton("إدارة المستخدمين", callback_data="manage_users")],
        [InlineKeyboardButton("بيانات مستخدمين", callback_data="user_data")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_main")]
    ])

# VIP subscription required menu
def get_vip_required_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("دعوة 5 أشخاص", callback_data="invite_5")],
        [InlineKeyboardButton("تفعيل عبر المدير", url=f"tg://user?id={ADMIN_ID}")]
    ])

# Management menus
def get_membership_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("تفعيل VIP", callback_data="activate_vip")],
        [InlineKeyboardButton("إيقاف VIP", callback_data="deactivate_vip")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_admin")]
    ])

def get_users_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("حظر مستخدم", callback_data="ban_user")],
        [InlineKeyboardButton("إيقاف حظر", callback_data="unban_user")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_admin")]
    ])

def get_data_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("سحب رقم", callback_data="extract_number")],
        [InlineKeyboardButton("معلومات مستخدم", callback_data="user_info")],
        [InlineKeyboardButton("سحب قناة", callback_data="extract_channel")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_admin")]
    ])

# Start command
@app.on_message(filters.command("start"))
async def start_command(client: Client, message: Message):
    user_id = message.from_user.id
    
    # Handle referral links
    if len(message.command) > 1 and message.command[1].startswith('ref_'):
        try:
            referrer_id = int(message.command[1].split('_')[1])
            if referrer_id != user_id:
                # Add referral
                storage.add_referral(referrer_id, user_id)
                
                # Update referrer's invite count
                referrer_data = storage.get_user(referrer_id) or get_default_user_data()
                referrer_data["invited_count"] = get_invite_count(referrer_id)
                storage.save_user(referrer_id, referrer_data)
                
                # Notify referrer
                try:
                    await client.send_message(
                        referrer_id, 
                        f"🎉 لديك دعوة جديدة! user_id: {user_id}\n"
                        f"الآن لديك {referrer_data['invited_count']}/5 دعوات مكتملة"
                    )
                except:
                    pass
        except Exception as e:
            logger.error(f"Referral error: {e}")
    
    # Check if user is admin
    if user_id == ADMIN_ID:
        await message.reply_text(
            "مرحباً بك أيها المدير!",
            reply_markup=get_admin_menu()
        )
        return
    
    # Check if user is banned
    user_data = storage.get_user(user_id)
    if user_data and user_data.get("banned", False):
        await message.reply_text("⛔ تم حظرك من استخدام البوت.")
        return
    
    # Create user if not exists
    if not user_data:
        user_data = get_default_user_data()
        storage.save_user(user_id, user_data)
    
    await message.reply_text(
        "مرحباً بك في بوت الدعم!",
        reply_markup=get_main_menu(user_id)
    )

# Callback queries
@app.on_callback_query()
async def handle_callback(client: Client, callback_query: CallbackQuery):
    user_id = callback_query.from_user.id
    data = callback_query.data
    
    try:
        if data == "back_main":
            await handle_back_main(callback_query, user_id)
        
        elif data == "back_admin":
            await handle_back_admin(callback_query)
        
        elif data == "session_control":
            await callback_query.edit_message_text(
                "التحكم بالجلسة",
                reply_markup=get_session_menu()
            )
        
        elif data == "register_account":
            await handle_register_account(callback_query)
        
        elif data == "set_bio":
            await handle_set_bio(callback_query)
        
        elif data == "statistics":
            await handle_statistics(callback_query, user_id)
        
        elif data == "delete_session":
            await handle_delete_session(callback_query, user_id)
        
        elif data == "toggle_ai":
            await handle_toggle_ai(callback_query, user_id)
        
        elif data == "invite_5":
            await handle_invite_5(callback_query, user_id)
        
        elif data == "check_subscription":
            await handle_check_subscription(callback_query, user_id)
        
        # Admin handlers
        elif user_id == ADMIN_ID:
            await handle_admin_callbacks(callback_query, data)
        
        await callback_query.answer()
    except Exception as e:
        logger.error(f"Callback error: {e}")
        await callback_query.answer("حدث خطأ!", show_alert=True)

async def handle_back_main(callback_query: CallbackQuery, user_id: int):
    if user_id == ADMIN_ID:
        await callback_query.edit_message_text(
            "لوحة تحكم المدير",
            reply_markup=get_admin_menu()
        )
    else:
        user_data = storage.get_user(user_id)
        auto_reply = user_data.get("auto_reply", False) if user_data else False
        
        await callback_query.edit_message_text(
            "القائمة الرئيسية",
            reply_markup=get_main_menu(user_id, auto_reply)
        )

async def handle_back_admin(callback_query: CallbackQuery):
    await callback_query.edit_message_text(
        "لوحة تحكم المدير",
        reply_markup=get_admin_menu()
    )

async def handle_admin_callbacks(callback_query: CallbackQuery, data: str):
    if data == "manage_membership":
        await callback_query.edit_message_text(
            "إدارة العضويات VIP",
            reply_markup=get_membership_menu()
        )
    elif data == "manage_users":
        await callback_query.edit_message_text(
            "إدارة المستخدمين",
            reply_markup=get_users_menu()
        )
    elif data == "user_data":
        await callback_query.edit_message_text(
            "بيانات المستخدمين",
            reply_markup=get_data_menu()
        )
    elif data == "activate_vip":
        await handle_activate_vip(callback_query)
    elif data == "deactivate_vip":
        await handle_deactivate_vip(callback_query)
    elif data == "ban_user":
        await handle_ban_user(callback_query)
    elif data == "unban_user":
        await handle_unban_user(callback_query)
    elif data == "extract_number":
        await handle_extract_number(callback_query)
    elif data == "user_info":
        await handle_user_info(callback_query)
    elif data == "extract_channel":
        await handle_extract_channel(callback_query)

# Handle account registration
async def handle_register_account(callback_query: CallbackQuery):
    user_id = callback_query.from_user.id
    
    # Ensure user exists
    if not storage.get_user(user_id):
        storage.save_user(user_id, get_default_user_data())
    
    storage.set_user_state(user_id, "awaiting_phone")
    await callback_query.edit_message_text(
        "للتسجيل، يرجى إرسال رقم هاتفك مع رمز الدولة.\n\n"
        "مثال: +201234567890\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Handle set bio
async def handle_set_bio(callback_query: CallbackQuery):
    user_id = callback_query.from_user.id
    
    storage.set_user_state(user_id, "awaiting_bio")
    await callback_query.edit_message_text(
        "يرجى إرسال النبذة الشخصية التي تريد تعيينها:\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Handle statistics
async def handle_statistics(callback_query: CallbackQuery, user_id: int):
    user_data = storage.get_user(user_id)
    
    if user_data:
        invite_count = get_invite_count(user_id)
        is_subscribed = await check_subscription(user_id)
        
        stats_text = f"""
📊 إحصائيات حسابك:

🔹 حالة الاشتراك: {'VIP 🥇' if user_data.get('vip', False) else 'عادي'}
🔹 الاشتراك في القناة: {'✅' if is_subscribed else '❌'}
🔹 عدد المدعوين: {invite_count}/5
🔹 حالة الرد التلقائي: {'✅ مفعل' if user_data.get('auto_reply', False) else '❌ معطل'}
🔹 النبذة: {user_data.get('bio', 'غير معينة')}
        """
    else:
        stats_text = "لم تقم بتسجيل حسابك بعد."
    
    await callback_query.edit_message_text(stats_text.strip())

# Handle delete session
async def handle_delete_session(callback_query: CallbackQuery, user_id: int):
    storage.delete_user(user_id)
    storage.clear_user_state(user_id)
    await session_manager.stop_user_session(user_id)
    
    await callback_query.edit_message_text("✅ تم حذف الجلسة بنجاح!")

# Handle AI toggle
async def handle_toggle_ai(callback_query: CallbackQuery, user_id: int):
    # Check subscription to mandatory channel
    is_subscribed = await check_subscription(user_id)
    if not is_subscribed:
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("الاشتراك في القناة", url=f"https://t.me/{MANDATORY_CHANNEL}")],
            [InlineKeyboardButton("تأكيد الاشتراك", callback_data="check_subscription")]
        ])
        await callback_query.edit_message_text(
            "⛔ يجب الاشتراك في القناة أولاً:\n@iIl337",
            reply_markup=keyboard
        )
        return
    
    # Check VIP subscription
    if not is_vip(user_id):
        invite_count = get_invite_count(user_id)
        if invite_count < 5:
            await callback_query.edit_message_text(
                f"عذراً، هذه الميزة متاحة لأعضاء VIP فقط 🥇\n\n"
                f"لديك {invite_count}/5 دعوة مكتملة\n\n"
                "يمكنك التفعيل عن طريق:\n"
                "• دعوة 5 أشخاص للقناة\n"
                "• أو التواصل مع المدير",
                reply_markup=get_vip_required_menu()
            )
            return
        else:
            # Auto upgrade to VIP
            storage.update_user(user_id, {"vip": True})
    
    # Toggle AI status
    user_data = storage.get_user(user_id)
    new_status = not user_data.get("auto_reply", False)
    storage.update_user(user_id, {"auto_reply": new_status})
    
    await callback_query.edit_message_text(
        f"✅ تم {'تفعيل' if new_status else 'إيقاف'} الرد التلقائي بنجاح!",
        reply_markup=get_main_menu(user_id, new_status)
    )

# Handle invite 5
async def handle_invite_5(callback_query: CallbackQuery, user_id: int):
    referral_link = generate_referral_link(user_id)
    invite_count = get_invite_count(user_id)
    
    await callback_query.edit_message_text(
        f"🎯 نظام الدعوات:\n\n"
        f"الدعوات المكتملة: {invite_count}/5\n\n"
        f"🔗 رابط الدعوة الخاص بك:\n`{referral_link}`\n\n"
        "سيصبح المدعوون أعضاء VIP بعد:\n"
        "1. استخدام رابط الدعوة\n"
        "2. الاشتراك في القناة @iIl337"
    )

# Handle check subscription
async def handle_check_subscription(callback_query: CallbackQuery, user_id: int):
    is_subscribed = await check_subscription(user_id)
    if is_subscribed:
        # Update referral subscriptions
        storage.update_referral_subscription(user_id)
        
        await callback_query.edit_message_text(
            "✅ تم التحقق من الاشتراك!\n\n"
            "يمكنك الآن استخدام الميزات المتاحة.",
            reply_markup=get_main_menu(user_id)
        )
    else:
        await callback_query.answer("لم تشترك في القناة بعد!", show_alert=True)

# Admin: Handle activate VIP
async def handle_activate_vip(callback_query: CallbackQuery):
    storage.set_user_state(callback_query.from_user.id, "admin_activate_vip")
    await callback_query.edit_message_text(
        "أرسل معرف المستخدم لتفعيل VIP:\n\n"
        "مثال: 123456789\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Admin: Handle deactivate VIP
async def handle_deactivate_vip(callback_query: CallbackQuery):
    storage.set_user_state(callback_query.from_user.id, "admin_deactivate_vip")
    await callback_query.edit_message_text(
        "أرسل معرف المستخدم لإلغاء VIP:\n\n"
        "مثال: 123456789\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Admin: Handle ban user
async def handle_ban_user(callback_query: CallbackQuery):
    storage.set_user_state(callback_query.from_user.id, "admin_ban_user")
    await callback_query.edit_message_text(
        "أرسل معرف المستخدم للحظر:\n\n"
        "مثال: 123456789\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Admin: Handle unban user
async def handle_unban_user(callback_query: CallbackQuery):
    storage.set_user_state(callback_query.from_user.id, "admin_unban_user")
    await callback_query.edit_message_text(
        "أرسل معرف المستخدم لإلغاء الحظر:\n\n"
        "مثال: 123456789\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Admin: Handle extract number
async def handle_extract_number(callback_query: CallbackQuery):
    all_users = storage.get_all_users()
    numbers = []
    
    for user_id_str, user_data in all_users.items():
        if user_data.get("phone"):
            numbers.append((int(user_id_str), user_data["phone"]))
    
    if not numbers:
        await callback_query.edit_message_text("❌ لا توجد أرقام مسجلة")
        return
    
    # Create buttons for numbers (first 10)
    keyboard = []
    for user_id, phone in numbers[:10]:
        keyboard.append([InlineKeyboardButton(f"{phone}", callback_data=f"monitor_{user_id}")])
    
    keyboard.append([InlineKeyboardButton("🔙 رجوع", callback_data="user_data")])
    
    await callback_query.edit_message_text(
        "📱 قائمة الأرقام المسجلة:\n\n"
        "انقر على الرقم لمراقبته:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

# Admin: Handle user info
async def handle_user_info(callback_query: CallbackQuery):
    storage.set_user_state(callback_query.from_user.id, "admin_user_info")
    await callback_query.edit_message_text(
        "أرسل معرف المستخدم لعرض معلوماته:\n\n"
        "مثال: 123456789\n\n"
        "أو ارسل /cancel للإلغاء"
    )

# Admin: Handle extract channel
async def handle_extract_channel(callback_query: CallbackQuery):
    all_users = storage.get_all_users()
    users_with_channels = []
    
    for user_id_str in all_users.keys():
        user_channels = storage.get_user_channels(int(user_id_str))
        if user_channels:
            users_with_channels.append(int(user_id_str))
    
    if not users_with_channels:
        await callback_query.edit_message_text("❌ لا توجد قنوات مسجلة")
        return
    
    # Create buttons for users with channels
    keyboard = []
    for user_id in users_with_channels[:10]:
        keyboard.append([InlineKeyboardButton(f"المستخدم {user_id}", callback_data=f"user_channels_{user_id}")])
    
    keyboard.append([InlineKeyboardButton("🔙 رجوع", callback_data="user_data")])
    
    await callback_query.edit_message_text(
        "📢 قائمة المستخدمين الذين لديهم قنوات:\n\n"
        "انقر على المستخدم لعرض قنواته:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

# Handle phone number input
@app.on_message(filters.private & filters.regex(r'^\+\d{10,15}$'))
async def handle_phone_input(client: Client, message: Message):
    user_id = message.from_user.id
    phone = message.text
    
    state, _ = storage.get_user_state(user_id)
    if state == "awaiting_phone":
        # Save phone number
        storage.update_user(user_id, {"phone": phone})
        storage.clear_user_state(user_id)
        
        await message.reply_text(
            f"✅ تم حفظ رقم الهاتف: {phone}\n\n"
            "سيتم الآن إرسال كود التحقق...\n\n"
            "⚠️ هذه مجرد محاكاة. في التطبيق الحقيقي، ستتم إضافة نظام التحقق الفعلي.",
            reply_markup=get_main_menu(user_id)
        )

# Handle bio input
@app.on_message(filters.private & filters.text & ~filters.command)
async def handle_bio_input(client: Client, message: Message):
    user_id = message.from_user.id
    text = message.text
    
    state, _ = storage.get_user_state(user_id)
    if state == "awaiting_bio":
        if len(text) > 10 and len(text) < 500:
            storage.update_user(user_id, {"bio": text})
            storage.clear_user_state(user_id)
            await message.reply_text("✅ تم تعيين النبذة الشخصية بنجاح!", reply_markup=get_main_menu(user_id))
        else:
            await message.reply_text("❌ النبذة يجب أن تكون بين 10 و 500 حرف.")

# Handle admin commands
@app.on_message(filters.private & filters.text & filters.user(ADMIN_ID))
async def handle_admin_commands(client: Client, message: Message):
    user_id = message.from_user.id
    text = message.text
    
    state, _ = storage.get_user_state(user_id)
    if not state:
        return
    
    if state == "admin_activate_vip":
        try:
            target_user_id = int(text)
            storage.update_user(target_user_id, {"vip": True})
            storage.clear_user_state(user_id)
            await message.reply_text(f"✅ تم تفعيل VIP للمستخدم {target_user_id}")
        except ValueError:
            await message.reply_text("❌ معرف المستخدم غير صحيح")
    
    elif state == "admin_deactivate_vip":
        try:
            target_user_id = int(text)
            storage.update_user(target_user_id, {"vip": False})
            storage.clear_user_state(user_id)
            await message.reply_text(f"✅ تم إلغاء VIP للمستخدم {target_user_id}")
        except ValueError:
            await message.reply_text("❌ معرف المستخدم غير صحيح")
    
    elif state == "admin_ban_user":
        try:
            target_user_id = int(text)
            storage.update_user(target_user_id, {"banned": True})
            storage.clear_user_state(user_id)
            await message.reply_text(f"✅ تم حظر المستخدم {target_user_id}")
        except ValueError:
            await message.reply_text("❌ معرف المستخدم غير صحيح")
    
    elif state == "admin_unban_user":
        try:
            target_user_id = int(text)
            storage.update_user(target_user_id, {"banned": False})
            storage.clear_user_state(user_id)
            await message.reply_text(f"✅ تم إلغاء حظر المستخدم {target_user_id}")
        except ValueError:
            await message.reply_text("❌ معرف المستخدم غير صحيح")
    
    elif state == "admin_user_info":
        try:
            target_user_id = int(text)
            user_data = storage.get_user(target_user_id)
            if user_data:
                info_text = f"""
📋 معلومات المستخدم {target_user_id}:

🆔 المعرف: {target_user_id}
📞 الهاتف: {user_data.get('phone', 'غير مسجل')}
📝 النبذة: {user_data.get('bio', 'غير معينة')}
⭐ VIP: {'نعم' if user_data.get('vip', False) else 'لا'}
🔒 محظور: {'نعم' if user_data.get('banned', False) else 'لا'}
📅 تاريخ الإنشاء: {user_data.get('created_at', 'غير معروف')}
                """
                await message.reply_text(info_text.strip())
            else:
                await message.reply_text("❌ المستخدم غير موجود")
            storage.clear_user_state(user_id)
        except ValueError:
            await message.reply_text("❌ معرف المستخدم غير صحيح")

# Handle cancel command
@app.on_message(filters.command("cancel"))
async def handle_cancel(client: Client, message: Message):
    user_id = message.from_user.id
    storage.clear_user_state(user_id)
    await message.reply_text("✅ تم الإلغاء.", reply_markup=get_main_menu(user_id))

# Auto-reply handler for private messages
@app.on_message(filters.private & ~filters.bot)
async def handle_private_messages(client: Client, message: Message):
    user_id = message.from_user.id
    
    # Don't respond to admin in auto-reply mode
    if user_id == ADMIN_ID:
        return
    
    # Check if user is banned
    user_data = storage.get_user(user_id)
    if not user_data or user_data.get("banned", False):
        return
    
    auto_reply_enabled = user_data.get("auto_reply", False)
    state, _ = storage.get_user_state(user_id)
    
    if auto_reply_enabled and not state:
        # Get AI response
        ai_response = await get_ai_response(message.text)
        await message.reply_text(ai_response)

# Admin SOS command
@app.on_message(filters.command("sos") & filters.user(ADMIN_ID))
async def admin_sos(client: Client, message: Message):
    await message.reply_text(
        "👑 لوحة تحكم المدير",
        reply_markup=get_admin_menu()
    )

# Initialize storage and start bot
if __name__ == "__main__":
    # Ensure data directory exists
    if not os.path.exists("data"):
        os.makedirs("data")
    
    print("✅ Bot is running with httpx and file-based storage...")
    app.run()
