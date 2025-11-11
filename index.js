const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

/*
====================================================
📌 إعداد التوكن والرابط العام (Webhook URL)
====================================================
قم بتعديل المتغيرين أدناه حسب بياناتك:
- BOT_TOKEN: توكن بوت تيليجرام
- WEBHOOK_URL: رابط مشروعك على Render أو الاستضافة (بدون / في النهاية)
====================================================
*/

const BOT_TOKEN = '8005112027:AAFz3kRjsHIL9StGAALX9uCWxrDAFtQPthc'; // ← ضع توكن بوتك هنا
const WEBHOOK_URL = 'https://weep-1.onrender.com'; // ← غيّر هذا إلى رابط مشروعك على Render

// التحقق من القيم
if (!BOT_TOKEN || !WEBHOOK_URL) {
    console.error("❌ خطأ: يجب تحديد BOT_TOKEN و WEBHOOK_URL داخل الكود.");
    process.exit(1);
}

// تخزين المهام النشطة
const activePings = new Map();
const PING_INTERVAL_MS = 10 * 1000; // 10 ثوانٍ

// ======================================================
// 🧩 دوال المساعدة
// ======================================================
async function sendTelegramMessage(chatId, text, reply_markup = {}) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            reply_markup: reply_markup
        });
    } catch (error) {
        console.error("Error sending message:", error.response?.data?.description || error.message);
    }
}

// ======================================================
// 🚀 دالة إرسال Ping
// ======================================================
async function sendPing(url, chatId) {
    try {
        await axios.get(url, { timeout: 8000 }); 
        console.log(`[${chatId}] ✅ Ping successful for ${url}`);
    } catch (error) {
        console.error(`[${chatId}] ❌ Ping failed for ${url}: ${error.message}`);
        
        const pingData = activePings.get(chatId);
        if (pingData && !pingData.isNotified) {
            sendTelegramMessage(chatId, `⚠️ **تنبيه:** فشل أول طلب Ping للرابط: \`${url}\`. تأكد من أن الرابط يعمل.`);
            pingData.isNotified = true;
        }
    }
}

// ======================================================
// ⚙️ إدارة مهام Ping
// ======================================================
function startPinging(chatId, url) {
    stopPinging(chatId, false);
    sendPing(url, chatId);

    const intervalId = setInterval(() => sendPing(url, chatId), PING_INTERVAL_MS);
    activePings.set(chatId, { url, intervalId, isNotified: false });
    
    const intervalSeconds = PING_INTERVAL_MS / 1000;
    const stopButton = { 
        inline_keyboard: [
            [{ text: "🛑 إيقاف المراقبة", callback_data: `stop_ping_${chatId}` }]
        ]
    };
    
    sendTelegramMessage(chatId, 
        `🎉 **تم بدء المراقبة!**\n\n` +
        `🔗 الرابط: \`${url}\`\n` +
        `⏱️ كل ${intervalSeconds} ثانية.\n\n` +
        `✅ سيتم منع خمول مشروعك الآن.`,
        stopButton
    );
}

function stopPinging(chatId, notify = true) {
    if (activePings.has(chatId)) {
        clearInterval(activePings.get(chatId).intervalId);
        const url = activePings.get(chatId).url;
        activePings.delete(chatId);
        
        if (notify) {
            sendTelegramMessage(chatId, `❌ **تم إيقاف المراقبة!**\n\nالرابط: \`${url}\``);
        }
        return true;
    }
    return false;
}

// ======================================================
// 🤖 استقبال Webhook من تيليجرام
// ======================================================
app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    const update = req.body;
    
    if (update.message) handleMessage(update.message);
    else if (update.callback_query) handleCallbackQuery(update.callback_query);
    
    res.sendStatus(200);
});

// معالجة الأوامر النصية
function handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;

    if (!text) return;

    if (text === '/start') {
        sendTelegramMessage(chatId, 
            `مرحباً بك 👋\n\n` +
            `أنا بوت لمراقبة مشاريعك ومنعها من النوم 💤\n\n` +
            `استخدم:\n` +
            `- \`/ping <رابط مشروعك>\` لبدء المراقبة\n` +
            `- \`/status\` لمعرفة الحالة\n` +
            `- \`/stop\` لإيقاف المراقبة`
        );
    } else if (text.startsWith('/ping ')) {
        const url = text.substring(6).trim();
        if (url.startsWith('http')) startPinging(chatId, url);
        else sendTelegramMessage(chatId, '❌ أدخل رابطًا صحيحًا يبدأ بـ http أو https.');
    } else if (text === '/status') {
        const currentPing = activePings.get(chatId);
        if (currentPing) {
            sendTelegramMessage(chatId, 
                `🟢 **نشط**\n🔗 ${currentPing.url}\n⏱️ كل 10 ثوانٍ.`,
                { inline_keyboard: [[{ text: "🛑 إيقاف", callback_data: `stop_ping_${chatId}` }]] }
            );
        } else {
            sendTelegramMessage(chatId, '🔴 لا يوجد مراقبة حالياً.');
        }
    } else if (text === '/stop') {
        if (!stopPinging(chatId))
            sendTelegramMessage(chatId, '❌ لا يوجد عملية نشطة لإيقافها.');
    } else {
        sendTelegramMessage(chatId, '🤖 أمر غير معروف. أرسل `/start` للمساعدة.');
    }
}

// أزرار الإيقاف
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data.startsWith('stop_ping_')) {
        const targetChatId = parseInt(data.split('_')[2], 10);
        
        if (targetChatId !== chatId) {
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: "لا يمكنك التحكم في مراقبة مستخدم آخر.",
                show_alert: true
            });
            return;
        }

        if (stopPinging(chatId)) {
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                text: `✅ **تم الإيقاف بنجاح**`,
                parse_mode: 'Markdown'
            });
        }

        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: "تم الإيقاف."
        });
    }
}

// ======================================================
// 🌐 إعداد Webhook
// ======================================================
app.get('/setup', async (req, res) => {
    const webhookUrl = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    const setWebhookUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
    
    try {
        const response = await axios.get(setWebhookUrl);
        if (response.data.ok) {
            res.send(`✅ Webhook تم تعيينه بنجاح: ${webhookUrl}`);
            console.log(`Webhook set to: ${webhookUrl}`);
        } else {
            res.send(`❌ فشل التعيين: ${response.data.description}`);
        }
    } catch (error) {
        res.send(`❌ خطأ: ${error.message}`);
    }
});

// صفحة الفحص
app.get('/', (req, res) => {
    res.send("✅ Telegram Pinger Bot is running.");
});

// تشغيل الخادم
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`لضبط الـ Webhook: ${WEBHOOK_URL}/setup`);
});
