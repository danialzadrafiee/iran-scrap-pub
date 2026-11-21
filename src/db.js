// دیتابیس Postgres (Neon) — هاردکد، عمداً بدون env
const { Pool, types } = require('pg');
types.setTypeParser(20, Number); // BIGINT → number (زمان‌ها میلی‌ثانیه‌اند)
const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, ROOT } = require('./config');

const DATABASE_URL =
  'postgresql://neondb_owner:npg_UxDRVyc7At0n@ep-wispy-dawn-bbezzbvg-pooler.c-15.us-east-1.aws.neon.tech/neondb?sslmode=verify-full';

// فقط برای تست: DB_SCHEMA=test_x → schema جدا، از طریق اتصال مستقیم (بدون pooler)
// (SET search_path روی pooler بین اتصال‌ها نشت می‌کند — هرگز روی pooler استفاده نشود)
const SCHEMA_NAME = /^test_[a-z0-9_]+$/.test(process.env.DB_SCHEMA || '') ? process.env.DB_SCHEMA : null;
const CONN = SCHEMA_NAME
  ? DATABASE_URL.replace('-pooler', '') + '&options=' + encodeURIComponent('-c search_path=' + SCHEMA_NAME)
  : DATABASE_URL;

const pool = new Pool({ connectionString: CONN, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 20000 });
pool.on('error', (e) => console.error('pg pool error:', e.message));

const q = (sql, args = []) => pool.query(sql, args);
const rows = async (sql, args) => (await q(sql, args)).rows;
const one = async (sql, args) => (await q(sql, args)).rows[0] || null;

// تراکنش روی یک کانکشن
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn((sql, args = []) => c.query(sql, args));
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// زمان‌ها BIGINT میلی‌ثانیه (Date.now())
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER, sort INTEGER DEFAULT 0, selected BOOLEAN DEFAULT false
);
-- وضعیت اسکن هر دسته: تا اولین اسکن کامل نشده، توقف با «تکراری» فعال نیست (برای ادامه دقیق بعد از قطعی)
CREATE TABLE IF NOT EXISTS category_state (
  category_id INTEGER PRIMARY KEY, full_scan_done BOOLEAN DEFAULT false,
  first_scan_at BIGINT, last_scan_at BIGINT, last_run_id INTEGER, products_total INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  uuid TEXT PRIMARY KEY, url TEXT NOT NULL, category_id INTEGER, first_seen BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | no_inperson | error
  attempts INTEGER DEFAULT 0, processed_at BIGINT, run_id INTEGER
);
CREATE INDEX IF NOT EXISTS products_pending ON products(first_seen) WHERE status='pending';
CREATE TABLE IF NOT EXISTS shops (
  id BIGINT PRIMARY KEY, name TEXT, category_id INTEGER, product_url TEXT,
  first_seen BIGINT NOT NULL, last_seen BIGINT NOT NULL, exported_at BIGINT, run_id INTEGER
);
CREATE TABLE IF NOT EXISTS phones (
  phone TEXT PRIMARY KEY, shop_id BIGINT NOT NULL, type TEXT NOT NULL, first_seen BIGINT NOT NULL, run_id INTEGER
);
CREATE INDEX IF NOT EXISTS phones_shop ON phones(shop_id);
CREATE TABLE IF NOT EXISTS proxies (
  url TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'ok', fails INTEGER DEFAULT 0,
  cooldown_until BIGINT DEFAULT 0, cooldown_reason TEXT, last_used BIGINT DEFAULT 0, last_ip TEXT, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY, started_at BIGINT NOT NULL, finished_at BIGINT, trigger TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'running',           -- running | done | stopped | error | interrupted
  new_shops INTEGER DEFAULT 0, new_phones INTEGER DEFAULT 0, products_done INTEGER DEFAULT 0,
  last_category_id INTEGER, note TEXT
);
-- خلاصه هر دسته در هر اجرا
CREATE TABLE IF NOT EXISTS run_categories (
  run_id INTEGER, category_id INTEGER, started_at BIGINT, finished_at BIGINT,
  seen INTEGER DEFAULT 0, added INTEGER DEFAULT 0, stop_reason TEXT,
  PRIMARY KEY (run_id, category_id)
);
CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY, run_id INTEGER, ts BIGINT NOT NULL, message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_run ON logs(run_id, id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;

let ready;
function init() {
  ready ??= (async () => {
    if (SCHEMA_NAME) await q(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
    await q(SCHEMA);
    // اجرایی که با خاموش شدن برنامه نیمه‌کاره ماند
    await q(`UPDATE runs SET status='interrupted', finished_at=$1 WHERE status='running'`, [Date.now()]);
    await seedCategories();
  })();
  return ready;
}

async function seedCategories(force = false) {
  const { c } = await one('SELECT COUNT(*)::int c FROM categories');
  if (c && !force) return;
  const file = path.join(ROOT, 'assets/categories.json');
  if (fs.existsSync(file)) await saveCategoryTree(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// درخت [{id,name,children}] → جدول (انتخاب‌های قبلی حفظ می‌شود)
async function saveCategoryTree(tree) {
  const flat = [];
  const walk = (nodes, parent) => nodes.forEach((n) => { flat.push([n.id, n.name, parent, flat.length]); if (n.children) walk(n.children, n.id); });
  walk(tree, null);
  const seen = new Set();
  const uniq = flat.filter(([id]) => !seen.has(id) && seen.add(id));
  await tx(async (t) => {
    const sel = (await t('SELECT id FROM categories WHERE selected')).rows.map((r) => r.id);
    await t('DELETE FROM categories');
    await t(
      `INSERT INTO categories (id,name,parent_id,sort,selected)
       SELECT id,name,parent_id,sort, id = ANY($5::int[]) FROM unnest($1::int[],$2::text[],$3::int[],$4::int[]) AS x(id,name,parent_id,sort)`,
      [uniq.map((r) => r[0]), uniq.map((r) => r[1]), uniq.map((r) => r[2]), uniq.map((r) => r[3]), sel]
    );
  });
}

async function getSetting(k) {
  const r = await one('SELECT value FROM settings WHERE key=$1', [k]);
  return r ? r.value : DEFAULT_SETTINGS[k];
}
const setSetting = (k, v) => q('INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=excluded.value', [k, String(v)]);
async function allSettings() {
  const r = Object.fromEntries((await rows('SELECT key,value FROM settings')).map((x) => [x.key, x.value]));
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, r[k] ?? DEFAULT_SETTINGS[k]]));
}

module.exports = { pool, q, rows, one, tx, init, saveCategoryTree, seedCategories, getSetting, setSetting, allSettings };
