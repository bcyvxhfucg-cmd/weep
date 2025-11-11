const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// ✅ توكن البوت (ثابت في الكود)
const BOT_TOKEN = '8005112027:AAFz3kRjsHIL9StGAALX9uCWxrDAFtQPthc';

// ✅ رابط مشروعك على Render (ثابت في الكود)
const WEBHOOK_URL = 'https://weep-1.onrender.com';

// ======================================================
// ⚙️ إعدادات عامة
// ======================================================
const activePings = new Map();
const PING_INTERVAL_MS = 10 * 1000; // كل 10 ثوانٍ

// ======================================================
// 🛠️ دالة إرسال رسالة عبر تيليجرام
// ======================================================
async function sendTelegramMessage(chatId, text, reply_markup = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup
    });
  } catch (error) {
    console.error("Error sending message:", error.response?.data?.description || error.message);
  }
}

// ======================================================
// 🏃 محرك PING
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
// ⚙️ إدارة المراقبة
// ======================================================
function startPinging(chatId, url) {
  stopPinging(chatId, false);
  sendPing(url, chatId);

  const intervalId = setInterval(() => sendPing(url, chatId), PING_INTERVAL_MS);
  activePings.set(chatId, { url, intervalId, isNotified: false });

  const intervalSeconds = PING_INTERVAL_MS / 1000;
  const stopButton = { inline_keyboard: [[{ text: "🛑 إيقاف المراقبة", callback_data: `stop_ping_${chatId}` }]] };

  sendTelegramMessage(
    chatId,
    `🎉 **تم بدء المراقبة بنجاح!**\n\n🔗 الرابط: \`${url}\`\n⏱️ الفاصل الزمني: *${intervalSeconds} ثوانٍ*\n\n✅ سيظل البوت نشطًا الآن.`,
    stopButton
  );
}

function stopPinging(chatId, notify = true) {
  if (activePings.has(chatId)) {
    clearInterval(activePings.get(chatId).intervalId);
    const url = activePings.get(chatId).url;
    activePings.delete(chatId);
    if (notify) sendTelegramMessage(chatId, `❌ **تم إيقاف المراقبة!**\n\nتم إيقاف خدمة منع الخمول للرابط: \`${url}\`.`);
    return true;
  }
  return false;
}

// ======================================================
// 🤖 استقبال التحديثات من تيليجرام (Webhook)
// ======================================================
app.use(express.json());

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  const update = req.body;
  if (update.message) handleMessage(update.message);
  else if (update.callback_query) handleCallbackQuery(update.callback_query);
  res.sendStatus(200);
});

function handleMessage(message) {
  const chatId = message.chat.id;
  const text = message.text;

  if (!text) return;

  if (text === '/start') {
    sendTelegramMessage(
      chatId,
      `مرحباً بك في **بوت مراقب النشاط!** 🤖\n\nأنا أساعدك في منع مشاريعك من الخمول بإرسال طلبات Keep-Alive كل 10 ثوانٍ.\n\n**الاستخدام:**\n1️⃣ أرسل:\n\`/ping <رابط مشروعك>\`\nمثال:\n\`/ping https://weep-1.onrender.com\`\n\n2️⃣ لمعرفة الحالة:\n\`/status\`\n\n3️⃣ لإيقاف المراقبة:\n\`/stop\` أو استخدم الزر.`
    );
  } else if (text.startsWith('/ping ')) {
    const url = text.substring(6).trim();
    if (url.startsWith('http')) startPinging(chatId, url);
    else sendTelegramMessage(chatId, '❌ **خطأ:** يجب أن يبدأ الرابط بـ http أو https.');
  } else if (text === '/status') {
    const ping = activePings.get(chatId);
    if (ping) {
      sendTelegramMessage(
        chatId,
        `🟢 **الحالة:** نشطة\n🔗 الرابط: \`${ping.url}\`\n⏱️ الفاصل: 10 ثوانٍ`,
        { inline_keyboard: [[{ text: "🛑 إيقاف المراقبة", callback_data: `stop_ping_${chatId}` }]] }
      );
    } else {
      sendTelegramMessage(chatId, '🔴 لا توجد مراقبة حالياً. أرسل `/ping <رابطك>` للبدء.');
    }
  } else if (text === '/stop') {
    if (!stopPinging(chatId)) sendTelegramMessage(chatId, '❌ لا يوجد مراقبة نشطة لإيقافها.');
  } else {
    sendTelegramMessage(chatId, '🤔 أمر غير معروف. أرسل `/start` للمساعدة.');
  }
}

function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('stop_ping_')) {
    if (stopPinging(chatId)) {
      axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        text: `✅ **تم إيقاف المراقبة**.`,
        parse_mode: 'Markdown'
      });
    }

    axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackQuery.id,
      text: "تم الإيقاف بنجاح."
    });
  }
}

// ======================================================
// 🌐 إعداد Webhook
// ======================================================
app.get('/setup', async (req, res) => {
  const webhookUrl = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    if (response.data.ok) {
      res.status(200).send(`✅ تم تعيين Webhook بنجاح إلى: ${webhookUrl}`);
      console.log(`Webhook set to: ${webhookUrl}`);
    } else {
      res.status(500).send(`❌ فشل تعيين Webhook: ${response.data.description}`);
    }
  } catch (error) {
    res.status(500).send(`❌ خطأ في الاتصال بـ Telegram API: ${error.message}`);
  }
});

// ======================================================
// 🩺 فحص الحالة
// ======================================================
app.get('/', (req, res) => {
  res.status(200).send("✅ Telegram Pinger Bot is running successfully on Render!");
});

// ======================================================
// 🚀 بدء الخادم
// ======================================================
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`To set the Webhook, visit: ${WEBHOOK_URL}/setup`);
});
