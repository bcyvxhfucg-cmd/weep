const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// ⚠️ BOT_TOKEN must be set as an environment variable in Render.
const BOT_TOKEN = process.env.BOT_TOKEN; 

// 🌐 The public URL of this application on Render (WEBHOOK_URL).
const WEBHOOK_URL = process.env.WEBHOOK_URL; 

if (!BOT_TOKEN || !WEBHOOK_URL) {
    console.error("Critical Error: BOT_TOKEN and WEBHOOK_URL must be set as environment variables.");
    process.exit(1);
}

// Map to store active ping intervals: { chatId: { url: string, intervalId: IntervalObject, isNotified: boolean } }
const activePings = new Map();
const PING_INTERVAL_MS = 10 * 1000; // 10 seconds

// ======================================================
// 🛠️ Utility Functions
// ======================================================

// Function to send a message via Telegram API
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
// 🏃 Background PING Engine
// ======================================================

// Function to send the actual HTTP ping request
async function sendPing(url, chatId) {
    try {
        await axios.get(url, { timeout: 8000 }); 
        console.log(`[${chatId}] ✅ Ping successful for ${url}`);
    } catch (error) {
        console.error(`[${chatId}] ❌ Ping failed for ${url}: ${error.message}`);
        
        // Notify user only once upon first failure
        const pingData = activePings.get(chatId);
        if (pingData && !pingData.isNotified) {
            sendTelegramMessage(chatId, `⚠️ **تنبيه:** فشل أول طلب Ping للرابط: \`${url}\`. تأكد من أن الرابط يعمل بشكل صحيح. سنستمر في المحاولة...`);
            pingData.isNotified = true;
        }
    }
}

// ======================================================
// ⚙️ PING Task Management
// ======================================================

function startPinging(chatId, url) {
    // Stop any previous task for the same user
    stopPinging(chatId, false); 
    
    // Send first Ping immediately
    sendPing(url, chatId);

    // Start the periodic task (every 10 seconds)
    const intervalId = setInterval(() => sendPing(url, chatId), PING_INTERVAL_MS);
    
    // Save the task to the map
    activePings.set(chatId, { url, intervalId, isNotified: false });
    
    const intervalSeconds = PING_INTERVAL_MS / 1000;
    
    const stopButton = { 
        inline_keyboard: [
            [{ text: "🛑 إيقاف المراقبة", callback_data: `stop_ping_${chatId}` }]
        ]
    };
    
    sendTelegramMessage(chatId, 
        `🎉 **تم بدء المراقبة بنجاح!**\n\n` +
        `🔗 الرابط: \`${url}\`\n` +
        `⏱️ الفاصل الزمني: *${intervalSeconds} ثوانٍ*\n\n` +
        `✅ سيظل البوت الخاص بك نشطًا الآن في الخلفية.`,
        stopButton
    );
}

function stopPinging(chatId, notify = true) {
    if (activePings.has(chatId)) {
        clearInterval(activePings.get(chatId).intervalId);
        const url = activePings.get(chatId).url;
        activePings.delete(chatId);
        
        if (notify) {
            sendTelegramMessage(chatId, `❌ **تم إيقاف المراقبة!**\n\nتم إيقاف خدمة منع الخمول للرابط: \`${url}\`.`);
        }
        return true;
    }
    return false;
}

// ======================================================
// 🤖 Webhook Handling (Receiving Telegram Updates)
// ======================================================

app.use(express.json());

// Webhook endpoint
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    const update = req.body;
    
    if (update.message) {
        handleMessage(update.message);
    } else if (update.callback_query) {
        handleCallbackQuery(update.callback_query);
    }
    
    // Always send 200 OK response immediately to Telegram
    res.sendStatus(200); 
});

// Process text messages
function handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;

    if (!text) return;

    if (text === '/start') {
        sendTelegramMessage(chatId, 
            `مرحباً بك في **بوت مراقب النشاط!** 🤖\n\n` +
            `أنا هنا لمنع مشاريعك المستضافة (مثل Render) من الخمول عبر إرسال طلبات Keep-Alive كل 10 ثوانٍ.\n\n` +
            `**طريقة الاستخدام:**\n` +
            `1. **لبدء المراقبة:** أرسل الأمر التالي:\n` +
            `   \`/ping <رابط مشروعك>\`\n` +
            `   *مثال: /ping https://bot-telgram-4lwg.onrender.com*\n\n` +
            `2. **للتحقق من الحالة:** أرسل \`/status\`\n` +
            `3. **للإيقاف:** أرسل \`/stop\` أو استخدم زر الإيقاف.`
        );
    } else if (text.startsWith('/ping ')) {
        const url = text.substring(6).trim();
        // Simple URL validation
        if (url.startsWith('http')) {
            startPinging(chatId, url);
        } else {
            sendTelegramMessage(chatId, '❌ **خطأ:** يرجى إرسال رابط صحيح يبدأ بـ `http` أو `https`.');
        }
    } else if (text === '/status') {
        const currentPing = activePings.get(chatId);
        if (currentPing) {
            sendTelegramMessage(chatId, 
                `🟢 **حالة المراقبة:** نشط\n` +
                `🔗 الرابط: \`${currentPing.url}\`\n` +
                `⏱️ الفاصل: 10 ثوانٍ\n\n` +
                `البوت يعمل في الخلفية لمنع خمول مشروعك.`,
                 { 
                    inline_keyboard: [
                        [{ text: "🛑 إيقاف المراقبة", callback_data: `stop_ping_${chatId}` }]
                    ]
                }
            );
        } else {
            sendTelegramMessage(chatId, '🔴 **حالة المراقبة:** متوقف. يرجى استخدام الأمر `/ping <رابطك>` للبدء.');
        }
    } else if (text === '/stop') {
        if (stopPinging(chatId)) {
            // Stop message handled inside stopPinging
        } else {
            sendTelegramMessage(chatId, '❌ لا يوجد رابط فعال يتم مراقبته حاليًا لإيقافه.');
        }
    } else {
        sendTelegramMessage(chatId, '🤔 أمر غير معروف. للمساعدة أرسل `/start`.');
    }
}

// Process inline button presses
function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data.startsWith('stop_ping_')) {
        const targetChatId = parseInt(data.substring(10), 10);
        
        // Security check: only allow the user who started the ping to stop it.
        if (targetChatId !== chatId) {
             axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callbackQuery.id,
                text: "لا يمكنك التحكم في مراقبة مستخدم آخر.",
                show_alert: true
            });
            return;
        }

        if (stopPinging(chatId)) {
             // Edit the original message to reflect the stopped status
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                text: `✅ **تم الإيقاف بنجاح**\n\nتم إيقاف المراقبة للرابط: \`${activePings.get(chatId)?.url || "غير معروف"}\`.`,
                parse_mode: 'Markdown'
            });
        }
        
        // Acknowledge the button press
        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: "تم إيقاف المراقبة."
        });
    }
}

// ======================================================
// 🌐 Webhook Setup Endpoint (Run this once after deployment)
// ======================================================
app.get('/setup', async (req, res) => {
    const webhookUrl = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    const setWebhookUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
    
    try {
        const response = await axios.get(setWebhookUrl);
        if (response.data.ok) {
            res.status(200).send(`✅ تم تعيين Webhook بنجاح إلى: ${webhookUrl}`);
            console.log(`Webhook set successfully to: ${webhookUrl}`);
        } else {
            res.status(500).send(`❌ فشل تعيين Webhook: ${response.data.description}`);
            console.error('Failed to set webhook:', response.data.description);
        }
    } catch (error) {
        res.status(500).send(`❌ خطأ في الاتصال بـ Telegram API: ${error.message}`);
        console.error('API connection error:', error.message);
    }
});

// Basic health check endpoint
app.get('/', (req, res) => {
    res.status(200).send("The Telegram Pinger Bot Webhook service is running.");
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    // Instruction to the user
    console.log(`To set the Webhook, visit: ${WEBHOOK_URL}/setup`);
});
