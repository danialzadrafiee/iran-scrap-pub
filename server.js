// سرور: API پنل + فایل‌های بیلدشده UI + زمان‌بندی روزانه
const express = require('express');
const path = require('path');
const fs = require('fs');
const { PORT, ROOT } = require('./src/config');
const { q, rows, init, allSettings, setSetting, saveCategoryTree, tx } = require('./src/db');
const engine = require('./src/engine');
const proxies = require('./src/proxies');
const leads = require('./src/leads');
const { recent, log } = require('./src/log');
const { testProxy, BrowserManager } = require('./src/browser');
const { discover } = require('./src/categories');

const app = express();
app.use(express.json({ limit: '2mb' }));
const api = express.Router();
app.use('/api', api);
// خطای async → JSON
const h = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ ok: false, error: e.message }); });

// ---------- وضعیت ----------
api.get('/state', h(async (req, res) => {
  const s = engine.state;
  res.json({
    run: { id: s.runId, running: s.running, stopping: s.stopRequested && s.running, phase: s.phase, catIndex: s.catIndex, catTotal: s.catTotal, catName: s.catName, catId: s.catId,
      catDone: s.catDone, catTotalProducts: s.catTotalProducts, productTitle: s.productTitle, lastEvent: s.lastEvent,
      newShops: s.newShops, newPhones: s.newPhones, productsDone: s.productsDone, proxy: engine.currentProxy(), waiting: s.waiting, error: s.error, startedAt: s.startedAt },
    stats: await leads.stats(),
    proxies: await proxies.count(),
    log: recent(+req.query.after || 0),
  });
}));
api.post('/run', h(async (req, res) => {
  if (engine.state.running) return res.json({ ok: false, error: 'در حال اجراست' });
  const only = Array.isArray(req.body?.categories) && req.body.categories.length ? req.body.categories.map(Number) : null;
  if (!only && !(await leads.stats()).selectedCats) return res.json({ ok: false, error: 'اول دسته‌ها را انتخاب کنید' });
  engine.run('manual', only);
  res.json({ ok: true });
}));
api.post('/stop', (req, res) => { engine.stop(); res.json({ ok: true }); });

// ---------- داشبورد دسته‌ها ----------
api.get('/dashboard', h(async (req, res) => res.json(await leads.categoryStatus())));
api.post('/categories/toggle', h(async (req, res) => {
  await q('UPDATE categories SET selected=$1 WHERE id=$2', [!!req.body.selected, +req.body.id]);
  res.json({ ok: true });
}));

// ---------- تاریخچه ----------
api.get('/runs', h(async (req, res) => res.json(await leads.runs(30))));
api.get('/runs/:id', h(async (req, res) => res.json(await leads.runDetail(+req.params.id))));

// ---------- لیدها ----------
api.get('/leads', h(async (req, res) => res.json(await leads.query({ ...req.query, limit: 2000 }))));
api.get('/export', h(async (req, res) => {
  const scope = req.query.scope === 'new' ? 'new' : 'all';
  const list = await leads.query({ ...req.query, scope });
  const buf = await leads.toExcel(list);
  if (scope === 'new') await leads.markExported(list.map((r) => r.id));
  const name = `leads-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"` });
  res.send(Buffer.from(buf));
}));

// ---------- دسته‌ها ----------
api.get('/categories', h(async (req, res) => {
  const list = await rows('SELECT id,name,parent_id,selected FROM categories ORDER BY sort');
  const byId = new Map(list.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of byId.values()) (r.parent_id && byId.get(r.parent_id) ? byId.get(r.parent_id).children : roots).push(r);
  res.json(roots);
}));
api.post('/categories', h(async (req, res) => {
  const ids = (req.body.selected || []).map(Number);
  await tx(async (t) => {
    await t('UPDATE categories SET selected=false WHERE selected');
    await t('UPDATE categories SET selected=true WHERE id = ANY($1::int[])', [ids]);
  });
  res.json({ ok: true, count: ids.length });
}));
let refreshing = false;
api.post('/categories/refresh', h(async (req, res) => {
  if (engine.state.running || refreshing) return res.json({ ok: false, error: 'الان ممکن نیست' });
  refreshing = true;
  const bm = new BrowserManager();
  try {
    const tree = await discover(bm);
    if (tree.length < 5) throw new Error('دسته‌ها خوانده نشد');
    await saveCategoryTree(tree);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  } finally {
    await bm.close();
    refreshing = false;
  }
}));

// ---------- پروکسی ----------
api.get('/proxies', h(async (req, res) => res.json((await proxies.list()).map((p) => ({ ...p, coolingFor: Math.max(0, p.cooldown_until - Date.now()) })))));
api.post('/proxies', h(async (req, res) => res.json({ ok: true, count: await proxies.setFromText(req.body.text || '') })));
api.post('/proxies/test', h(async (req, res) => {
  const list = await proxies.list();
  const out = [];
  for (let i = 0; i < list.length; i += 3) {
    const part = await Promise.all(list.slice(i, i + 3).map(async (p) => ({ url: p.url, ...(await testProxy(p.url)) })));
    for (const r of part) {
      if (r.ok) { await proxies.revive(r.url); await proxies.setIp(r.url, r.ip); }
      else await proxies.mark(r.url, 'fail');
    }
    out.push(...part);
  }
  res.json(out);
}));

// ---------- تنظیمات ----------
api.get('/settings', h(async (req, res) => res.json(await allSettings())));
api.post('/settings', h(async (req, res) => {
  for (const k of ['speed', 'maxPerCategory', 'dailyAt']) if (k in req.body) await setSetting(k, req.body[k]);
  res.json(await allSettings());
}));

// ---------- UI بیلدشده ----------
const dist = path.join(ROOT, 'ui/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- زمان‌بندی روزانه ----------
let lastScheduled = '';
setInterval(async () => {
  try {
    const at = (await allSettings()).dailyAt;
    if (!at) return;
    const now = new Date();
    const key = now.toDateString() + at;
    if (now.toTimeString().slice(0, 5) === at && lastScheduled !== key && !engine.state.running && (await leads.stats()).selectedCats) {
      lastScheduled = key;
      log('اجرای زمان‌بندی‌شده روزانه');
      engine.run('schedule');
    }
  } catch {}
}, 20000);

const shutdown = () => { engine.stop(); setTimeout(() => process.exit(0), 4000); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

init()
  .then(() => app.listen(PORT, () => log(`پنل روی http://localhost:${PORT}`)))
  .catch((e) => { console.error('اتصال به دیتابیس ناموفق:', e.message); process.exit(1); });
