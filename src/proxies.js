// مدیریت پروکسی‌ها: انتخاب، استراحت (cooldown)، خراب
const { q, rows, one, tx } = require('./db');
const { PROXY_MAX_FAILS, COOLDOWN_CAPTCHA_MS, COOLDOWN_SHADOWBAN_MS } = require('./config');
const { log } = require('./log');

const list = () => rows('SELECT * FROM proxies ORDER BY sort');
const count = async () => (await one('SELECT COUNT(*)::int c FROM proxies')).c;

// جایگزینی لیست از متن (هر خط یک پروکسی). وضعیت پروکسی‌های قبلی حفظ می‌شود.
async function setFromText(text) {
  const urls = [...new Set(text.split(/\s+/).map((s) => s.trim()).filter(Boolean))].map((u) => (/^\w+:\/\//.test(u) ? u : 'http://' + u));
  await tx(async (t) => {
    await t('DELETE FROM proxies WHERE NOT (url = ANY($1::text[]))', [urls]);
    for (const [i, u] of urls.entries()) await t('INSERT INTO proxies (url,sort) VALUES ($1,$2) ON CONFLICT (url) DO UPDATE SET sort=excluded.sort', [u, i]);
  });
  return urls.length;
}

// پروکسی سالمی که کمتر از همه استفاده شده؛ null اگر همه در استراحت/خراب
async function pick() {
  return one(
    `UPDATE proxies SET last_used=$1 WHERE url = (
       SELECT url FROM proxies WHERE status='ok' AND cooldown_until<=$1 ORDER BY last_used LIMIT 1
     ) RETURNING *`,
    [Date.now()]
  );
}

const nextAvailableAt = async () => (await one(`SELECT MIN(cooldown_until) t FROM proxies WHERE status='ok'`)).t;

async function mark(url, reason) {
  if (!url) return;
  const short = url.replace(/^\w+:\/\//, '').slice(0, 14);
  if (reason === 'ok') {
    await q('UPDATE proxies SET fails=0 WHERE url=$1 AND fails>0', [url]);
  } else if (reason === 'fail') {
    await q(`UPDATE proxies SET fails=fails+1, status=CASE WHEN fails+1>=$1 THEN 'dead' ELSE status END WHERE url=$2`, [PROXY_MAX_FAILS, url]);
    log('پروکسی خطای اتصال:', short);
  } else {
    const ms = reason === 'captcha' ? COOLDOWN_CAPTCHA_MS : COOLDOWN_SHADOWBAN_MS;
    await q('UPDATE proxies SET cooldown_until=$1, cooldown_reason=$2 WHERE url=$3', [Date.now() + ms, reason, url]);
    log(`پروکسی استراحت (${reason === 'captcha' ? 'کپچا' : 'محدودیت شماره'}، ${ms / 60000} دقیقه):`, short);
  }
}

const setIp = (url, ip) => q('UPDATE proxies SET last_ip=$1 WHERE url=$2', [ip, url]);
const revive = (url) => q(`UPDATE proxies SET status='ok', fails=0, cooldown_until=0 WHERE url=$1`, [url]);

module.exports = { list, count, setFromText, pick, nextAvailableAt, mark, setIp, revive };
