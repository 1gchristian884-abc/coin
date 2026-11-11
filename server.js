'use strict';
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

// ---------- Config (todo por variables de entorno) ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEBAPP_URL = process.env.WEBAPP_URL; // ej: https://coin-vych.vercel.app
const PUBLIC_URL = process.env.PUBLIC_URL; // URL pública de ESTE backend (Render)
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // string aleatorio largo
const PORT = process.env.PORT || 3000;

for (const [k, v] of Object.entries({ BOT_TOKEN, DATABASE_URL, WEBAPP_URL, PUBLIC_URL, WEBHOOK_SECRET })) {
  if (!v) { console.error(`Falta la variable de entorno ${k}`); process.exit(1); }
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on('error', (e) => console.error('Error en el pool de Postgres:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
const bot = new Telegraf(BOT_TOKEN);

// ---------- Catálogo (los precios los define el SERVIDOR) ----------
const DAYS = [1, 7, 15, 30, 60];
const SERVERS = {
  basset: { name: 'Basset', daily: 300000, prices: [499, 3499, 6999, 12999, 23999] },
  atlas:  { name: 'Atlas',  daily: 500000, prices: [1343, 4699, 9399, 17499, 31000] },
  zenith: { name: 'Zenith', daily: 750000, prices: [2318, 8100, 16100, 29999, 55000] },
  elite:  { name: 'Elite',  daily: 1000000, prices: [2999, 10500, 20999, 38999, 69999] },
};
const MULTS = { 2: 450, 4: 1200, 6: 2500, 8: 4500, 10: 6800 };
const ENERGY = [
  { amount: 500, stars: 499 }, { amount: 1000, stars: 899 }, { amount: 1500, stars: 1199 },
  { amount: 3000, stars: 2149 }, { amount: 6000, stars: 4099 }, { amount: 12000, stars: 7799 },
];

// itemKey: "srv:basset:7" | "mul:4" | "eng:2"
function resolveItem(itemKey) {
  const [type, a, b] = String(itemKey).split(':');
  if (type === 'srv') {
    const s = SERVERS[a]; const i = DAYS.indexOf(Number(b));
    if (!s || i < 0) return null;
    return { type, title: `Servidor ${s.name} (${b} d)`, stars: s.prices[i], server: a, days: Number(b), reward: s.daily * Number(b) };
  }
  if (type === 'mul') {
    const stars = MULTS[a];
    return stars ? { type, title: `Multiplicador x${a}`, stars, value: Number(a) } : null;
  }
  if (type === 'eng') {
    const p = ENERGY[Number(a)];
    return p ? { type, title: `Batería +${p.amount}`, stars: p.stars, amount: p.amount } : null;
  }
  return null;
}

// ---------- Validación de initData de Telegram ----------
function validateInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc, 'hex'); const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // máx 24 h
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

function auth(req, res, next) {
  const user = validateInitData(req.get('X-Telegram-Init-Data'));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.tgUser = user;
  next();
}

async function ensureUser(user) {
  await pool.query(
    `INSERT INTO users (id, username) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
    [user.id, user.username || user.first_name || null]
  );
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: WEBAPP_URL.replace(/\/+$/, '') }));

// NO se sirve todo el directorio (antes exponía server.js). Solo lo necesario:
app.get('/health', (req, res) => res.send('ok'));

app.get('/api/me', auth, async (req, res) => {
  try {
  await ensureUser(req.tgUser);
  const { rows } = await pool.query(
    `SELECT multiplier, max_capacity, automine,
            (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1)::int AS referrals,
            (SELECT COUNT(*) FROM payments WHERE user_id = $1)::int AS purchases
     FROM users WHERE id = $1`, [req.tgUser.id]);
  res.json(rows[0]);
  } catch (e) {
    console.error('/api/me falló:', e.message);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/invoice', auth, async (req, res) => {
  const item = resolveItem(req.body && req.body.itemKey);
  if (!item) return res.status(400).json({ error: 'invalid_item' });
  try {
    await ensureUser(req.tgUser);
    const nonce = crypto.randomBytes(4).toString('hex');
    const payload = `${req.tgUser.id}|${req.body.itemKey}|${nonce}`; // < 128 bytes
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: item.title,
      description: `Compra en VYCH Coin Miner: ${item.title}`,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: item.title, amount: item.stars }],
    });
    res.json({ invoiceLink });
  } catch (e) {
    console.error('/api/invoice falló:', e.message);
    res.status(500).json({ error: 'invoice_failed' });
  }
});

// ---------- Bot ----------
function parsePayload(payload) {
  const [uid, itemKey] = String(payload).split('|');
  return { uid: Number(uid), itemKey };
}

bot.on('pre_checkout_query', async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const { uid, itemKey } = parsePayload(q.invoice_payload);
  const item = resolveItem(itemKey);
  const ok = item && uid === q.from.id && q.currency === 'XTR' && q.total_amount === item.stars;
  await ctx.answerPreCheckoutQuery(!!ok, ok ? undefined : 'No se pudo validar la compra.');
});

bot.on('successful_payment', async (ctx) => {
  const p = ctx.message.successful_payment;
  const { uid, itemKey } = parsePayload(p.invoice_payload);
  const item = resolveItem(itemKey);
  if (!item || uid !== ctx.from.id || p.total_amount !== item.stars) {
    console.error('Pago inconsistente', p);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // charge_id único => idempotente si Telegram reenvía el evento
    const ins = await client.query(
      `INSERT INTO payments (charge_id, user_id, item_key, stars)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING charge_id`,
      [p.telegram_payment_charge_id, uid, itemKey, p.total_amount]);
    if (ins.rowCount) {
      if (item.type === 'srv') {
        const now = Date.now();
        const automine = { serverId: item.server, days: item.days, rewardTotal: item.reward,
          startedAt: now, endsAt: now + item.days * 86400000, paid: 0 };
        await client.query('UPDATE users SET automine = $2 WHERE id = $1', [uid, automine]);
      } else if (item.type === 'mul') {
        await client.query('UPDATE users SET multiplier = $2 WHERE id = $1', [uid, item.value]);
      } else if (item.type === 'eng') {
        await client.query('UPDATE users SET max_capacity = max_capacity + $2 WHERE id = $1', [uid, item.amount]);
      }
    }
    await client.query('COMMIT');
    await ctx.reply('✅ Compra confirmada. Vuelve a la mini app.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
  } finally {
    client.release();
  }
});

bot.start(async (ctx) => {
  await ensureUser(ctx.from);
  const m = /^ref_(\d+)$/.exec(ctx.startPayload || '');
  if (m) {
    const referrer = Number(m[1]);
    if (referrer !== ctx.from.id) {
      // solo cuenta si el referido es nuevo y el referidor existe
      await pool.query(
        `INSERT INTO referrals (referred_id, referrer_id)
         SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2)
         ON CONFLICT DO NOTHING`, [ctx.from.id, referrer]);
    }
  }
  await ctx.reply('Bienvenido a VYCH Coin Miner ⚡', {
    reply_markup: { inline_keyboard: [[{ text: 'Abrir mini app', web_app: { url: WEBAPP_URL } }]] },
  });
});

// ---------- Arranque con webhook ----------
const hookPath = `/telegram/${WEBHOOK_SECRET}`;
app.use(bot.webhookCallback(hookPath));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY, username TEXT,
  multiplier INT NOT NULL DEFAULT 1, max_capacity INT NOT NULL DEFAULT 600,
  automine JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  item_key TEXT NOT NULL, stars INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS referrals (
  referred_id BIGINT PRIMARY KEY REFERENCES users(id),
  referrer_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

app.listen(PORT, async () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
  try { await pool.query(SCHEMA); console.log('Tablas listas'); }
  catch (e) { console.error('Error creando tablas:', e.message); }
  await bot.telegram.setWebhook(`${PUBLIC_URL}${hookPath}`, {
    allowed_updates: ['message', 'pre_checkout_query'],
  });
});
