require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.static(__dirname));


const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN. Copy .env.example to .env and paste your bot token in.');
  process.exit(1);
}

// Prices in Telegram Stars. Edit these to change what each tier costs.
const TIER_PRICES = {
  'Companion': 150,
  'Inner Circle': 400,
  'Founders': 900,
};

// --- Applications ---
// In-memory for now (resets on restart). Swap this array for a real
// database (Postgres, SQLite, etc.) before you rely on this in production.
const applications = [];

// Verifies that data really came from Telegram's Mini App, per:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userStr = params.get('user');
  return userStr ? JSON.parse(userStr) : null;
}

// The Mini App form POSTs here (this is what APPLICATION_ENDPOINT in
// eire-train.html should point to, e.g. https://yourdomain.com/applications).
app.post('/applications', (req, res) => {
  const { telegramInitData, ...answers } = req.body;
  const telegramUser = verifyInitData(telegramInitData);

  if (!telegramUser) {
    console.warn('Application received with unverified Telegram data — check your BOT_TOKEN matches the Mini App\'s bot.');
  }

  applications.push({
    ...answers,
    telegramUser,
    receivedAt: new Date().toISOString(),
  });

  console.log('New application from:', answers.name, answers.telegram);
  res.status(200).json({ ok: true });
});

// Quick way to see what's come in while testing.
// Lock this down (auth, or remove it) before this goes live for real.
app.get('/applications', (req, res) => {
  res.json(applications);
});

// --- Telegram bot webhook ---
// Register this URL with Telegram once deployed (see README).
app.post('/webhook', async (req, res) => {
  const update = req.body;

  // 1) Person tapped a tier button in the Mini App -> tg.sendData() fired
  //    -> Telegram delivers it here as a message with web_app_data.
  if (update.message && update.message.web_app_data) {
    const chatId = update.message.chat.id;
    let payload;
    try {
      payload = JSON.parse(update.message.web_app_data.data);
    } catch {
      payload = null;
    }

    if (payload && payload.action === 'subscribe' && TIER_PRICES[payload.tier]) {
      const tier = payload.tier;
      const price = TIER_PRICES[tier];

      await fetch(`${TELEGRAM_API}/sendInvoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          title: `${tier} tier`,
          description: `Monthly subscription — ${tier} tier`,
          payload: `subscribe_${tier}_${Date.now()}`,
          currency: 'XTR', // XTR = Telegram Stars
          prices: [{ label: `${tier} (monthly)`, amount: price }],
        }),
      });
    }
  }

  // 2) Telegram checking whether it's OK to charge — must answer within 10s.
  if (update.pre_checkout_query) {
    await fetch(`${TELEGRAM_API}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      }),
    });
  }

  // 3) Payment actually succeeded — this is where you'd grant channel
  //    access, tag the subscriber, add them to a database, etc.
  if (update.message && update.message.successful_payment) {
    const payment = update.message.successful_payment;
    console.log('Payment received:', payment.invoice_payload, payment.total_amount, 'Stars');
    // TODO: grant access — e.g. call the Bot API to add the user to your
    // private channel, or record the subscription in your database.
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
