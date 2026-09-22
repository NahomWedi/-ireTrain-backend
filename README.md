# Éire Train — bot backend

This is the missing piece between your form (`eire-train.html`) and your bot (`@Nahom_Wedi_bot`). It does two jobs:
1. Receives applications submitted from the form
2. Listens for tier selections and sends real Telegram Stars invoices

## 1. Install and run locally (to test)

```
cd telegram-bot-backend
npm install
cp .env.example .env
```

Open `.env` and paste your real bot token (the one BotFather gave you) in place of `paste_your_bot_token_here`.

```
npm start
```

You should see `Server running on port 3000`.

## 2. Deploy it somewhere reachable over HTTPS

Telegram needs to reach this server from the internet, so `localhost` won't work for real use. Easiest options: [Render](https://render.com), [Railway](https://railway.app), or [Fly.io](https://fly.io) — all have free tiers that work for this. Steps are roughly the same on each:

1. Push this folder to a GitHub repo (or upload it directly if the platform allows).
2. Create a new "Web Service" and point it at the repo.
3. Set the environment variable `BOT_TOKEN` in the platform's dashboard (don't commit your real `.env` file to GitHub).
4. Deploy. You'll get a URL like `https://eire-train-backend.onrender.com`.

## 3. Tell Telegram where your bot lives

Once deployed, register your server as the bot's webhook (replace both placeholders):

```
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://your-deployed-url.com/webhook"
```

You should get back `{"ok":true,"result":true,...}`.

## 4. Host the Mini App page itself

`eire-train.html` also needs a real HTTPS home (a Claude artifact link isn't meant to be your permanent production host). You can serve it from the same backend, or drop it on any static host — Netlify, Vercel, GitHub Pages all work.

Then register it with BotFather:
```
/newapp
```
Follow the prompts, select `@Nahom_Wedi_bot`, and give it the URL where `eire-train.html` is hosted.

## 5. Point the form at your backend

In `eire-train.html`, find:
```js
const APPLICATION_ENDPOINT = 'https://your-bot-backend.example.com/applications';
```
Replace it with your real deployed URL, e.g. `https://eire-train-backend.onrender.com/applications`.

## 6. Test the whole flow

1. Open your bot in Telegram, tap the Mini App button.
2. Fill out and submit the application — check `GET /applications` on your deployed URL (or your server logs) to confirm it arrived.
3. Go to the tiers screen and tap a tier — you should get a real Telegram Stars payment prompt.

## Notes

- Applications are stored in memory right now — they disappear if the server restarts. Swap the `applications` array in `server.js` for a real database before relying on this.
- The `successful_payment` handler in `server.js` just logs the payment. Add your own logic there for granting channel access once someone pays.
- Tier prices live in `TIER_PRICES` in `server.js` — edit the numbers there to change pricing.
