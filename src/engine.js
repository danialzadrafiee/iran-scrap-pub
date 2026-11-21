// موتور: دسته‌ها → محصولات (جدیدترین اول) → شماره فروشنده‌های حضوری
//
// ادامه از جای قطع شدن:
//   ۱) محصولات pending (از هر اجرای قبلی) اول تمام می‌شوند
//   ۲) اگر اجرای قبلی نیمه‌کاره بود، دسته‌هایی که در آن کامل شدند رد می‌شوند
//   ۳) اسکن اول هر دسته تا «حداکثر محصول» ادامه دارد حتی اگر به محصولات ثبت‌شده برسد
//      (چون ممکن است اسکن قبلی وسط کار قطع شده باشد) → بعد full_scan_done
// فقط چیزهای جدید (اجراهای بعدی):
//   لیست با ?sort=-date؛ بعد از ۳۰ محصول ثبت‌شده پشت‌سرهم، دسته تمام است
//   فروشگاهی که شماره‌اش را داریم کلیک نمی‌شود
const { q, rows, one, getSetting, init } = require('./db');
const { BrowserManager, CaptchaError, ShadowBanError, StopError, sleep } = require('./browser');
const { SPEED, KNOWN_STREAK_STOP, CITY_NAME } = require('./config');
const { log, setRun, flush } = require('./log');

const fa2en = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const phoneType = (p) => (p.startsWith('09') ? 'mobile' : 'landline');
const rand = ([a, b]) => a + Math.random() * (b - a);

const state = {
  running: false, stopRequested: false, runId: null,
  phase: '', catIndex: 0, catTotal: 0, catName: '', catId: null,
  catDone: 0, catTotalProducts: 0, productTitle: '', lastEvent: '',
  newShops: 0, newPhones: 0, productsDone: 0,
  waiting: null, error: null, startedAt: null,
};

const stopping = () => state.stopRequested;
async function wait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (stopping()) throw new StopError();
    await sleep(Math.min(500, end - Date.now()));
  }
}
let speedCache = null;
const speed = () => SPEED[speedCache] || SPEED.normal;

// ---------- مرحله ۱: لیست محصولات یک دسته ----------
async function listCategory(bm, cat, runId = null) {
  const max = +(await getSetting('maxPerCategory')) || 300;
  const st = await one('SELECT * FROM category_state WHERE category_id=$1', [cat.id]);
  const incremental = !!st?.full_scan_done;
  // اگر کمتر از ۳۰ محصول از این دسته ثبت شده، همان تعداد تکراری کافی است
  const streakStop = Math.max(1, Math.min(KNOWN_STREAK_STOP, st?.products_total || KNOWN_STREAK_STOP));
  const page = await withRetry(bm, () => bm.goto(`https://torob.com/browse/${cat.id}/?sort=-date&shop_type=offline`));
  const seen = new Set();
  let knownStreak = 0, added = 0, noGrowth = 0, reason = 'end', scrolls = 0;

  outer: while (true) {
    if (stopping()) throw new StopError();
    const hrefs = await page.$$eval('a[href^="/p/"]', (as) => as.map((a) => a.getAttribute('href').split('?')[0]));
    const fresh = [];
    for (const h of hrefs) {
      const uuid = h.split('/')[2];
      if (uuid && !seen.has(uuid)) { seen.add(uuid); fresh.push({ uuid, url: 'https://torob.com' + h }); }
    }
    if (fresh.length) {
      // یک کوئری برای کل این دسته از محصولات
      const known = new Set((await rows('SELECT uuid FROM products WHERE uuid = ANY($1::text[])', [fresh.map((f) => f.uuid)])).map((r) => r.uuid));
      const toAdd = [];
      let count = seen.size - fresh.length;
      for (const f of fresh) {
        count++;
        if (known.has(f.uuid)) knownStreak++;
        else { knownStreak = 0; toAdd.push(f); }
        if (incremental && knownStreak >= streakStop) { reason = 'known'; break; }
        if ((incremental ? added + toAdd.length : count) >= max) { reason = 'max'; break; }
      }
      if (toAdd.length) {
        await q(
          `INSERT INTO products (uuid,url,category_id,first_seen,run_id)
           SELECT u, l, $3, $4, $5 FROM unnest($1::text[], $2::text[]) AS x(u,l) ON CONFLICT DO NOTHING`,
          [toAdd.map((f) => f.uuid), toAdd.map((f) => f.url), cat.id, Date.now(), runId]
        );
        added += toAdd.length;
      }
      if (reason !== 'end') break outer;
    }
    noGrowth = fresh.length ? 0 : noGrowth + 1;
    state.phase = `پیدا کردن محصولات جدید: ${seen.size.toLocaleString('fa-IR')} دیده‌شده، ${added.toLocaleString('fa-IR')} جدید`;
    if (fresh.length && ++scrolls % 4 === 0) log(`«${cat.name}»: ${seen.size} محصول دیده شد تا الان، ${added} جدید…`);
    if (noGrowth >= 3) break; // ته لیست
    await page.keyboard.press('End').catch(() => {});
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await wait(rand([2000, 3000]));
  }

  await q(
    `INSERT INTO category_state (category_id, full_scan_done, first_scan_at, last_scan_at, last_run_id, products_total)
     VALUES ($1, true, $2, $2, $3, $4)
     ON CONFLICT (category_id) DO UPDATE SET full_scan_done=true, last_scan_at=$2, last_run_id=$3,
       products_total=category_state.products_total+$4`,
    [cat.id, Date.now(), runId, added]
  );
  const why = { known: 'به محصولات ثبت‌شده رسید', max: 'به سقف رسید', end: 'ته لیست' }[reason];
  log(`«${cat.name}»: ${seen.size} محصول دیده شد، ${added} جدید (${why}${incremental ? '' : '، اسکن اول'})`);
  return { seen: seen.size, added, reason };
}

// ---------- مرحله ۲: شماره‌های یک محصول ----------
async function processProduct(bm, prod, runId = null) {
  const page = await bm.goto(prod.url);
  const title = (await page.title().catch(() => '')).replace(/\s*\|\s*ترب.*$/, '').replace(/^خرید و قیمت\s*/, '').slice(0, 70);
  state.productTitle = title;
  const tag = `[${(state.catDone + 1).toLocaleString('fa-IR')}/${state.catTotalProducts.toLocaleString('fa-IR')}]`;
  const tab = page.getByText(/^خرید حضوری/).first();
  if (!(await tab.count())) {
    // مطمئن شو واقعاً صفحه محصول است (نه صفحه خطا/محدودیت) — وگرنه دوباره امتحان شود
    const isProduct = await page.getByText(/^فروشنده‌ها$|^خرید اینترنتی/).first().count().catch(() => 0);
    if (!isProduct) throw new Error('صفحه محصول درست لود نشد');
    log(`${tag} ${title}: فروشنده‌ای با شماره ندارد`);
    return 'no_inperson';
  }
  await tab.click().catch(() => {});
  await wait(1500);
  for (let k = 0; k < 5; k++) {
    const more = page.getByText(/^نمایش تمام .* فروشگاه$/).locator('visible=true').first();
    if (!(await more.count())) break;
    await more.click().catch(() => {});
    await wait(1500);
  }
  const cards = page.locator('[class*="inStoreSellerCard_shopCard"]');
  const n = await cards.count();
  // شناسه فروشگاه همه کارت‌ها → یک کوئری برای «کدام را داریم»
  const info = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const href = await card.locator('a[href*="/shop/"]').first().getAttribute('href').catch(() => null);
    const name = (await card.locator('[class*="inStoreSellerCard_shopName"]').first().innerText().catch(() => '')).trim();
    info.push({ card, shopId: +(href || '').split('/')[2] || -Math.abs(hash(name)), name });
  }
  const have = new Set((await rows('SELECT DISTINCT shop_id FROM phones WHERE shop_id = ANY($1::bigint[])', [info.map((x) => x.shopId)])).map((r) => +r.shop_id));
  const known = info.filter((x) => have.has(x.shopId)).map((x) => x.shopId);
  if (known.length) await q('UPDATE shops SET last_seen=$1 WHERE id = ANY($2::bigint[])', [Date.now(), known]);

  let emptyStreak = 0, gotNew = 0;
  for (const { card, shopId, name } of info) {
    if (stopping()) throw new StopError();
    if (have.has(shopId)) continue; // dedupe فروشگاه
    const btn = card.getByText('اطلاعات تماس', { exact: true }).first();
    if (!(await btn.count())) continue;
    const phones = await revealPhones(page, card, btn);
    if (!phones.length) {
      if (++emptyStreak >= 2) throw new ShadowBanError();
      continue;
    }
    emptyStreak = 0;
    const now = Date.now();
    const ins = await one(
      `INSERT INTO shops (id,name,category_id,product_url,first_seen,last_seen,run_id) VALUES ($1,$2,$3,$4,$5,$5,$6)
       ON CONFLICT (id) DO UPDATE SET last_seen=excluded.last_seen RETURNING (xmax = 0) AS inserted`,
      [shopId, name, prod.category_id, prod.url, now, runId]
    );
    if (ins?.inserted) state.newShops++;
    const r = await q(
      `INSERT INTO phones (phone,shop_id,type,first_seen,run_id) SELECT p, $2, t, $3, $4 FROM unnest($1::text[], $5::text[]) AS x(p,t) ON CONFLICT DO NOTHING`,
      [phones, shopId, now, runId, phones.map(phoneType)]
    );
    state.newPhones += r.rowCount;
    log(`  + ${name}: ${phones.join('، ')}`);
    state.lastEvent = `${name}: ${phones.join('، ')}`;
    have.add(shopId);
    gotNew++;
  }
  log(`${tag} ${title}: ${n} فروشنده — ${known.length} قبلاً ثبت‌شده، ${gotNew} فروشگاه جدید`);
  return 'done';
}

async function revealPhones(page, card, btn) {
  const read = () => card.evaluate((el) => [...el.querySelectorAll('*')].filter((e) => !e.children.length).map((e) => e.textContent.trim()));
  const extract = (texts) => [...new Set(texts.map((t) => fa2en(t).replace(/[\s-]/g, '')).filter((t) => /^0\d{7,10}$/.test(t)))];
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 5000 }).catch(() => {});
  await wait(rand(speed().click));
  // پروفایل تازه: پنجره انتخاب شهر → تهران → دوباره کلیک
  const city = page.getByRole('button', { name: CITY_NAME, exact: true }).locator('visible=true');
  if (await city.count()) {
    await city.first().click().catch(() => {});
    await wait(2000);
    await btn.click({ timeout: 5000 }).catch(() => {});
  }
  for (let t = 0; t < 6; t++) {
    const ph = extract(await read().catch(() => []));
    if (ph.length) return ph;
    await wait(500);
  }
  return [];
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h || 1; }

// کپچا/شدوبن/خطای پروکسی → چرخش پروکسی و تکرار (حداکثر ۴ بار)
async function withRetry(bm, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StopError) throw e;
      const reason = e instanceof CaptchaError ? 'captcha' : e instanceof ShadowBanError ? 'shadowban' : e.message === 'proxy-fail' ? 'fail' : null;
      if (!reason || attempt >= 4) throw e;
      log(reason === 'captcha' ? (e.rateLimit ? 'سایت محدودیت درخواست داد (429) → پروکسی بعدی' : 'کپچا → پروکسی بعدی') : reason === 'shadowban' ? 'شماره‌ها خالی (محدودیت) → پروکسی بعدی' : 'خطای پروکسی → پروکسی بعدی');
      await bm.rotate(reason);
    }
  }
}

async function saveRunProgress() {
  await q('UPDATE runs SET new_shops=$1, new_phones=$2, products_done=$3 WHERE id=$4', [state.newShops, state.newPhones, state.productsDone, state.runId]).catch(() => {});
}

async function catCounts(catId) {
  const r = await one(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status<>'pending')::int done FROM products WHERE category_id=$1`, [catId]);
  state.catTotalProducts = r.total;
  state.catDone = r.done;
}

async function processPending(bm, catIds = null) {
  while (!stopping()) {
    const prod = await one(`SELECT * FROM products WHERE status='pending' AND ($1::int[] IS NULL OR category_id = ANY($1::int[])) ORDER BY category_id, first_seen LIMIT 1`, [catIds]);
    if (!prod) break;
    if (prod.category_id !== state.catId) {
      const c = await one('SELECT name FROM categories WHERE id=$1', [prod.category_id]);
      Object.assign(state, { catId: prod.category_id, catName: c?.name || '' });
      await catCounts(prod.category_id);
    }
    state.phase = 'بررسی فروشگاه‌های هر محصول';
    await q('UPDATE products SET attempts=attempts+1 WHERE uuid=$1', [prod.uuid]);
    let status;
    try {
      status = await withRetry(bm, () => processProduct(bm, prod, state.runId));
    } catch (e) {
      if (e instanceof StopError) throw e;
      log('خطا در محصول:', e.message.split('\n')[0].slice(0, 100));
      status = prod.attempts + 1 >= 3 ? 'error' : null;
      if (!status) { await bm.close(); continue; }
    }
    await q('UPDATE products SET status=$1, processed_at=$2, run_id=$3 WHERE uuid=$4', [status, Date.now(), state.runId, prod.uuid]);
    state.productsDone++;
    state.catDone++;
    await saveRunProgress();
    await wait(rand(speed().page));
  }
}

// دسته‌هایی که در اجرای نیمه‌کاره قبلی کامل شدند (برای رد کردن)
async function doneInLastIncompleteRun() {
  const last = await one(`SELECT id, status FROM runs WHERE id <> $1 ORDER BY id DESC LIMIT 1`, [state.runId]);
  if (!last || last.status === 'done') return new Set();
  const r = await rows('SELECT category_id FROM run_categories WHERE run_id=$1 AND finished_at IS NOT NULL', [last.id]);
  return new Set(r.map((x) => x.category_id));
}

// ---------- اجرای کامل ----------
async function run(trigger = 'manual', onlyCats = null) {
  if (state.running) return false;
  Object.assign(state, { running: true, stopRequested: false, phase: 'شروع…', catIndex: 0, catTotal: 0, catName: '', catId: null, catDone: 0, catTotalProducts: 0, productTitle: '', lastEvent: '', newShops: 0, newPhones: 0, productsDone: 0, waiting: null, error: null, startedAt: Date.now() });
  let status = 'done';
  let bm;
  try {
    await init();
    speedCache = await getSetting('speed');
    state.runId = (await one('INSERT INTO runs (started_at, trigger) VALUES ($1,$2) RETURNING id', [Date.now(), trigger])).id;
    setRun(state.runId);
    log(`شروع اجرای #${state.runId}`);
    bm = currentBm = new BrowserManager(stopping, (msg) => { if (msg && msg !== state.waiting) log(msg); state.waiting = msg; });

    const pendingCount = (await one(`SELECT COUNT(*)::int c FROM products WHERE status='pending' AND ($1::int[] IS NULL OR category_id = ANY($1::int[]))`, [onlyCats])).c;
    if (pendingCount) { log(`ادامه از جای قبلی: ${pendingCount} محصول نیمه‌کاره`); await processPending(bm, onlyCats); }

    const skip = onlyCats ? new Set() : await doneInLastIncompleteRun();
    if (skip.size) log(`${skip.size} دسته در اجرای قبلی کامل شده بود — رد می‌شود`);
    const cats = onlyCats
      ? await rows('SELECT id,name FROM categories WHERE id = ANY($1::int[]) ORDER BY sort', [onlyCats])
      : (await rows('SELECT id,name FROM categories WHERE selected ORDER BY sort')).filter((c) => !skip.has(c.id));
    if (onlyCats) log(`فقط دسته: ${cats.map((c) => c.name).join('، ')}`);
    state.catTotal = cats.length;
    for (const [i, cat] of cats.entries()) {
      if (stopping()) break;
      Object.assign(state, { catIndex: i + 1, catName: cat.name, catId: cat.id, phase: 'پیدا کردن محصولات جدید', productTitle: '' });
      await q('INSERT INTO run_categories (run_id, category_id, started_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [state.runId, cat.id, Date.now()]);
      await q('UPDATE runs SET last_category_id=$1 WHERE id=$2', [cat.id, state.runId]);
      const res = await listCategory(bm, cat, state.runId);
      await catCounts(cat.id);
      await processPending(bm, [cat.id]);
      await q('UPDATE run_categories SET finished_at=$1, seen=$2, added=$3, stop_reason=$4 WHERE run_id=$5 AND category_id=$6', [Date.now(), res.seen, res.added, res.reason, state.runId, cat.id]);
    }
    if (stopping()) status = 'stopped';
  } catch (e) {
    if (e instanceof StopError) status = 'stopped';
    else { status = 'error'; state.error = e.message.split('\n')[0]; log('خطا:', e.message.split('\n')[0]); }
  } finally {
    if (bm) await bm.close();
    currentBm = null;
    if (state.runId) {
      await q('UPDATE runs SET finished_at=$1, new_shops=$2, new_phones=$3, products_done=$4, status=$5, note=$6 WHERE id=$7',
        [Date.now(), state.newShops, state.newPhones, state.productsDone, status, state.error, state.runId]).catch(() => {});
    }
    const label = { done: 'تمام شد', stopped: 'متوقف شد', error: 'خطا' }[status];
    log(`${label}: ${state.newShops} فروشگاه جدید، ${state.newPhones} شماره جدید`);
    await flush();
    setRun(null);
    Object.assign(state, { running: false, phase: '', waiting: null });
  }
  return true;
}

let currentBm = null;
const currentProxy = () => (currentBm?.proxy ? currentBm.proxy.url.replace(/^\w+:\/\//, '').slice(0, 16) + '…' : currentBm?.page ? 'بدون پروکسی' : '');
function stop() { state.stopRequested = true; }

module.exports = { run, stop, state, currentProxy, processProduct, listCategory };
