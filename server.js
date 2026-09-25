require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
// Serves eire-train.html (and any other file placed in this same repo folder)
app.use(express.static(__dirname));

const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN environment variable. Set it in Render → Environment.');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it in Render → Environment.');
  process.exit(1);
}

// Render's "Internal Database URL" doesn't need SSL (same private network).
// The "External Database URL" (host ends in .render.com) does need SSL.
const needsSSL = DATABASE_URL.includes('.render.com');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      name TEXT,
      address TEXT,
      email TEXT,
      telegram TEXT,
      hope TEXT,
      submitted_at TIMESTAMPTZ,
      telegram_init_data TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  console.log('Database ready: applications table checked/created.');
}

const TIER_PRICES = { 'Companion': 150, 'Inner Circle': 400, 'Founders': 900 };

function verifyInitData(initData) {
  if (!initData) return false;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    const dataCheckArr = [];
    for (const [key, value] of [...urlParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    return computedHash === hash;
  } catch (err) {
    console.error('verifyInitData error:', err);
    return false;
  }
}

app.post('/applications', async (req, res) => {
  const { name, address, email, telegram, hope, submittedAt, telegramInitData } = req.body || {};

  if (!name || !email || !telegram) {
    return res.status(400).json({ ok: false, error: 'Missing required fields.' });
  }

  try {
    await pool.query(
      `INSERT INTO applications (name, address, email, telegram, hope, submitted_at, telegram_init_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, address || null, email, telegram, hope || null, submittedAt || new Date().toISOString(), telegramInitData || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save application:', err);
    res.status(500).json({ ok: false, error: 'Server error saving application.' });
  }
});

// Debug endpoint — lists stored applications
app.get('/applications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch applications:', err);
    res.status(500).json({ ok: false, error: 'Server error fetching applications.' });
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.message && update.message.web_app_data) {
      const chatId = update.message.chat.id;
      let payload;
      try {
        payload = JSON.parse(update.message.web_app_data.data);
      } catch (err) {
        payload = null;
      }

      if (payload && payload.action === 'subscribe' && TIER_PRICES[payload.tier]) {
        const price = TIER_PRICES[payload.tier];
        await fetch(`${TELEGRAM_API}/sendInvoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            title: `Éire Train — ${payload.tier}`,
            description: `Monthly ${payload.tier} membership to Éire Train.`,
            payload: `tier_${payload.tier}_${Date.now()}`,
            currency: 'XTR',
            prices: [{ label: payload.tier, amount: price }],
          }),
        });
      }
    }

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

    if (update.message && update.message.successful_payment) {
      console.log('Successful payment:', update.message.successful_payment);
      // TODO: grant the user access to the paid tier (e.g. add to a channel, tag in DB)
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // Telegram expects 200 even on internal errors, to avoid retries piling up
  }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
