// لاگ: کنسول + بافر حافظه (پنل زنده) + ذخیره دسته‌ای در جدول logs
const mem = [];
let seq = 0;
let buffer = [];
let runId = null;

function log(...args) {
  const message = args.join(' ');
  const ts = Date.now();
  const time = new Date(ts).toLocaleTimeString('fa-IR', { hour12: false });
  mem.push({ id: ++seq, time, line: message });
  if (mem.length > 400) mem.shift();
  buffer.push([runId, ts, message]);
  console.log(`[${time}]`, message);
}

// هر ۲ ثانیه یک INSERT برای همه خطوط جدید (RTT دیتابیس بالاست)
async function flush() {
  if (!buffer.length) return;
  const batch = buffer;
  buffer = [];
  try {
    const { q } = require('./db');
    await q('INSERT INTO logs (run_id, ts, message) SELECT * FROM unnest($1::int[], $2::bigint[], $3::text[])', [
      batch.map((b) => b[0]), batch.map((b) => b[1]), batch.map((b) => b[2]),
    ]);
  } catch (e) {
    console.error('log flush failed:', e.message);
    buffer.unshift(...batch.slice(-500));
  }
}
setInterval(flush, 2000).unref();

const setRun = (id) => { runId = id; };
const recent = (after = 0) => mem.filter((l) => l.id > after);

module.exports = { log, recent, setRun, flush };
