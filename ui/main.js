const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
const get = (u) => fetch('/api/' + u).then((r) => r.json());
const post = (u, body = {}) => fetch('/api/' + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const dt = (ms) => (ms ? new Date(ms).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
function ago(ms) {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'همین الان';
  if (m < 60) return `${fa(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  const d = Math.round(h / 24);
  if (d < 30) return `${fa(d)} روز پیش`;
  return `${fa(Math.round(d / 30))} ماه پیش`;
}
function dur(a, b) {
  const s = Math.round(((b || Date.now()) - a) / 1000);
  if (s < 60) return `${fa(s)} ثانیه`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${fa(m)} دقیقه` : `${fa(Math.floor(m / 60))} ساعت و ${fa(m % 60)} دقیقه`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ================= تب‌ها و مودال‌ها =================
function showTab(name) {
  if (!['home', 'leads', 'history', 'settings', 'help'].includes(name)) name = 'home';
  $$('#nav .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('main > section').forEach((s) => s.classList.toggle('hidden', s.id !== 'tab-' + name));
  if (name === 'leads') loadLeads();
  if (name === 'history') loadRuns();
  if (name === 'settings') { loadProxies(); loadRunSettings(); }
  if (name === 'home') loadDashboard();
}
$('#nav').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) location.hash = b.dataset.tab; };
window.onhashchange = () => showTab(location.hash.slice(1));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) e.target.closest('.modal')?.classList.add('hidden');
  if (e.target.closest('[data-open-picker]')) openPicker();
});

// ================= وضعیت زنده =================
let logAfter = 0;
let run = { running: false };
let stats = {};
const events = [];

async function poll() {
  let s;
  try { s = await get('state?after=' + logAfter); } catch { return; }
  const was = run.running;
  run = s.run;
  stats = s.stats;
  renderKpis(s);
  renderRun(s);
  if (s.log.length) {
    const el = $('#log');
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    for (const l of s.log) { el.append(`[${l.time}] ${l.line}\n`); events.push(l); }
    events.splice(0, Math.max(0, events.length - 8));
    logAfter = s.log.at(-1).id;
    if (atBottom) el.scrollTop = el.scrollHeight;
    renderEvents();
  }
  if (was && !run.running) { toast(`اجرا تمام شد — ${fa(run.newShops)} فروشگاه جدید`); loadDashboard(); }
  if (run.running && Date.now() - (poll.lastDash || 0) > 8000) { poll.lastDash = Date.now(); if (!$('#tab-home').classList.contains('hidden')) loadDashboard(); }
}

function renderKpis(s) {
  const st = s.stats;
  $('#k-shops').textContent = fa(st.shops);
  $('#k-phones').textContent = fa(st.phones);
  $('#k-new').textContent = fa(st.newShops);
  $('#k-dl').classList.toggle('pointer-events-none', !st.newShops);
  $('#k-dl').classList.toggle('opacity-40', !st.newShops);
  $('#k-products').textContent = fa(st.products - st.pending);
  $('#k-pending').textContent = st.pending ? `${fa(st.pending)} محصول در صف بررسی` : 'صفی نمانده';
  const lr = st.lastRun;
  $('#k-last').textContent = s.run.running ? 'در حال اجرا' : lr ? ago(lr.finished_at) : 'هنوز اجرا نشده';
  $('#k-last-sub').textContent = lr && !s.run.running ? `${STATUS[lr.status]?.[1] || ''} · ${fa(lr.new_shops)} فروشگاه جدید` : '';
  $('#hdr-status').innerHTML = s.run.running ? '<span class="chip bg-sky-100 text-sky-700">● در حال اجرا</span>' : '';
}

function renderRun(s) {
  const r = s.run, st = s.stats;
  $('#run-idle').classList.toggle('hidden', r.running);
  $('#run-busy').classList.toggle('hidden', !r.running);
  $('#btn-run').disabled = !st.selectedCats;
  $('#run-hint').textContent = !st.selectedCats ? 'اول دسته‌ها را از جدول پایین اضافه کنید'
    : st.pending ? `${fa(st.pending)} محصول از دفعه قبل نیمه‌کاره مانده — اول همان‌ها را تمام می‌کند`
    : `${fa(st.selectedCats)} دسته انتخاب شده — فقط محصولات جدید بررسی می‌شوند`;
  if (r.running) {
    $('#r-phase').textContent = r.stopping ? 'در حال توقف… (کار فعلی تمام می‌شود)' : r.phase || 'در حال اجرا…';
    $('#r-elapsed').textContent = r.startedAt ? 'مدت: ' + dur(r.startedAt) : '';
    $('#r-cat').textContent = r.catName || '—';
    $('#r-catidx').textContent = r.catTotal ? `(${fa(r.catIndex)} از ${fa(r.catTotal)})` : '';
    $('#r-catnum').textContent = r.catTotalProducts ? `${fa(r.catDone)} از ${fa(r.catTotalProducts)} محصول` : '';
    $('#r-bar').style.width = (r.catTotalProducts ? Math.max(2, (r.catDone / r.catTotalProducts) * 100) : 2) + '%';
    $('#r-product').textContent = r.productTitle || '—';
    $('#r-event').textContent = r.lastEvent || '—';
    $('#r-prod').textContent = fa(r.productsDone);
    $('#r-new').textContent = fa(r.newShops);
    $('#r-phones').textContent = fa(r.newPhones);
    $('#r-proxy').textContent = r.proxy || '—';
  }
  $('#run-wait').classList.toggle('hidden', !r.waiting);
  $('#run-wait').textContent = r.waiting || '';
  $('#run-error').classList.toggle('hidden', !r.error || r.running);
  $('#run-error').textContent = r.error ? 'اجرای قبلی با خطا متوقف شد: ' + r.error : '';
}
function renderEvents() {
  $('#r-events').innerHTML = events.slice(-6).map((l) => `<div class="truncate ${l.line.includes('+') ? 'text-emerald-700' : /کپچا|خطا|محدود/.test(l.line) ? 'text-amber-700' : 'text-slate-600'}"><span class="text-slate-400">${l.time}</span> ${esc(l.line)}</div>`).join('');
}

setInterval(poll, 2000);

$('#btn-run').onclick = async () => {
  const r = await post('run');
  if (!r.ok) toast(r.error); else toast('شروع شد');
  poll();
};
$('#btn-stop').onclick = async () => { await post('stop'); toast('بعد از کار فعلی متوقف می‌شود'); poll(); };
$('#k-dl').onclick = () => setTimeout(() => { poll(); loadDashboard(); }, 1500);

// ================= جدول دسته‌ها =================
function catStatus(c) {
  if (run.running && run.catId === c.id) return ['bg-sky-100 text-sky-700', '● در حال اسکن'];
  if (!c.selected) return ['bg-slate-100 text-slate-500', 'غیرفعال'];
  if (!c.total && !c.last_scan_at) return ['bg-slate-100 text-slate-600', 'هنوز اسکن نشده'];
  if (c.pending) return ['bg-amber-100 text-amber-700', `نیمه‌کاره — ${fa(c.pending)} مانده`];
  if (!c.full_scan_done) return ['bg-amber-100 text-amber-700', 'اسکن اول ناتمام'];
  return ['bg-emerald-100 text-emerald-700', '✓ به‌روز'];
}
const lastResult = (c) => !c.last_finished_at ? '' : c.last_stop_reason === 'known' ? `آخرین بار: ${fa(c.last_added)} محصول جدید (تا محصولات قبلی)` : c.last_stop_reason === 'max' ? `آخرین بار: ${fa(c.last_added)} جدید (سقف)` : `آخرین بار: ${fa(c.last_added)} جدید`;

async function loadDashboard() {
  const list = await get('dashboard');
  $('#cat-empty').classList.toggle('hidden', list.some((c) => c.selected));
  $('#cat-rows').innerHTML = list.map((c) => {
    const s = catStatus(c);
    const checked = c.done + c.no_inperson + c.error;
    const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
    return `<tr class="border-t border-slate-100 ${c.selected ? '' : 'opacity-60'}">
      <td class="p-3">
        <div class="font-semibold">${esc(c.name)}</div>
        ${c.parent ? `<div class="text-xs text-slate-400">${esc(c.parent)}</div>` : ''}
      </td>
      <td class="p-3"><span class="chip ${s[0]} whitespace-nowrap">${s[1]}</span></td>
      <td class="p-3">
        ${c.total ? `<div class="bar" title="دارای فروشنده: ${fa(c.done)} · بدون فروشنده: ${fa(c.no_inperson)} · مانده: ${fa(c.pending)}">
            <div class="bg-emerald-500" style="width:${pct(c.done)}%"></div>
            <div class="bg-slate-300" style="width:${pct(c.no_inperson + c.error)}%"></div>
          </div>
          <div class="text-xs text-slate-500 mt-1">${fa(checked)} از ${fa(c.total)} محصول بررسی شده${c.pending ? ` · <span class="text-amber-700">${fa(c.pending)} مانده</span>` : ''}</div>`
        : '<span class="text-xs text-slate-400">—</span>'}
      </td>
      <td class="p-3 whitespace-nowrap">
        <b>${fa(c.shops)}</b> <span class="text-xs text-slate-500">فروشگاه</span>
        ${c.new_shops ? `<div class="text-xs text-emerald-600">${fa(c.new_shops)} جدید</div>` : ''}
      </td>
      <td class="p-3 text-xs">
        ${c.last_scan_at ? `<div title="${dt(c.last_scan_at)}">${ago(c.last_scan_at)}</div><div class="text-slate-400">${lastResult(c)}</div>` : '<span class="text-slate-400">هرگز</span>'}
        ${c.last_lead_at ? `<div class="text-slate-400">آخرین لید: ${ago(c.last_lead_at)}</div>` : ''}
      </td>
      <td class="p-3 whitespace-nowrap text-left">
        <button data-scan="${c.id}" class="btn-ghost py-1 px-2 text-xs" ${run.running ? 'disabled' : ''}>اسکن همین</button>
        ${c.selected
          ? `<button data-unsel="${c.id}" class="text-xs text-slate-400 hover:text-red-500 mr-1" title="حذف از دسته‌های فعال (داده‌ها می‌مانند)">✕</button>`
          : `<button data-sel="${c.id}" class="text-xs link mr-1">فعال کن</button>`}
      </td>
    </tr>`;
  }).join('');
}
$('#cat-rows').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.scan) {
    const r = await post('run', { categories: [+b.dataset.scan] });
    toast(r.ok ? 'اسکن این دسته شروع شد' : r.error);
    poll();
  }
  if (b.dataset.unsel || b.dataset.sel) {
    await post('categories/toggle', { id: +(b.dataset.unsel || b.dataset.sel), selected: !!b.dataset.sel });
    loadDashboard(); poll();
  }
};

// ================= انتخاب دسته (مودال) =================
let tree = [];
const desc = (nodes) => nodes.flatMap((n) => [n, ...desc(n.children)]);
const link = (nodes, parent = null) => nodes.forEach((n) => { n.parent = parent; link(n.children, n); });
const covered = (n) => { for (let p = n.parent; p; p = p.parent) if (p.selected) return true; return false; };

async function loadTree() {
  tree = await get('categories');
  link(tree);
  $('#f-cat').innerHTML = '<option value="">همه دسته‌ها</option>' + tree.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
}
async function openPicker() {
  await loadTree();
  $('#cat-q').value = '';
  renderTree();
  $('#picker').classList.remove('hidden');
}
$('#btn-add-cat').onclick = openPicker;
function renderTree() {
  const q = $('#cat-q').value.trim();
  const match = (n) => !q || n.name.includes(q) || n.children.some(match);
  const node = (n, depth) => {
    if (!match(n)) return '';
    const cov = covered(n);
    const label = `<label class="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-50 ${cov ? 'opacity-40' : ''}">
        <input type="checkbox" data-id="${n.id}" ${n.selected || cov ? 'checked' : ''} ${cov ? 'disabled' : ''} class="accent-emerald-600 w-4 h-4"/>
        <span class="${depth === 0 ? 'font-semibold' : ''}">${esc(n.name)}</span></label>`;
    if (!n.children.length) return `<div style="padding-right:${depth * 18 + 20}px">${label}</div>`;
    const open = q || desc(n.children).some((x) => x.selected);
    return `<details ${open ? 'open' : ''} style="padding-right:${depth * 18}px">
      <summary class="list-none flex items-center gap-1 cursor-pointer"><span class="text-slate-400 w-4 text-center">◂</span>${label}<span class="text-xs text-slate-400">(${fa(n.children.length)})</span></summary>
      ${n.children.map((c) => node(c, depth + 1)).join('')}</details>`;
  };
  $('#cat-tree').innerHTML = tree.map((t) => node(t, 0)).join('');
  $('#cat-count').textContent = fa(desc(tree).filter((n) => n.selected).length);
}
$('#cat-tree').addEventListener('click', (e) => { if (e.target.matches('input[type=checkbox]')) e.stopPropagation(); }, true);
$('#cat-tree').onchange = (e) => {
  const n = desc(tree).find((x) => x.id === +e.target.dataset.id);
  if (!n) return;
  n.selected = e.target.checked;
  if (n.selected) desc(n.children).forEach((c) => (c.selected = false)); // والد شامل فرزندان است
  renderTree();
};
$('#cat-q').oninput = renderTree;
$('#cat-clear').onclick = () => { desc(tree).forEach((n) => (n.selected = false)); renderTree(); };
$('#cat-save').onclick = async () => {
  const r = await post('categories', { selected: desc(tree).filter((n) => n.selected).map((n) => n.id) });
  toast(`ذخیره شد — ${fa(r.count)} دسته`);
  $('#picker').classList.add('hidden');
  loadDashboard(); poll();
};
$('#cat-refresh').onclick = async () => {
  if (!confirm('لیست دسته‌ها دوباره از سایت خوانده شود؟ (حدود یک دقیقه)')) return;
  toast('در حال خواندن دسته‌ها از سایت…');
  const r = await post('categories/refresh');
  toast(r.ok ? 'لیست دسته‌ها به‌روز شد' : r.error);
  await loadTree(); renderTree();
};

// ================= لیدها =================
const filters = { scope: 'all', type: '', category: '', q: '' };
const leadsQuery = () => new URLSearchParams(filters).toString();
let leadsTimer;
async function loadLeads() {
  const list = await get('leads?' + leadsQuery());
  $('#leads-body').innerHTML = list.map((r) => `
    <tr class="border-t border-slate-100 hover:bg-slate-50">
      <td class="p-3 font-semibold">${esc(r.name)} ${r.isNew ? '<span class="chip bg-emerald-100 text-emerald-700">جدید</span>' : ''}</td>
      <td class="p-3 font-mono" dir="ltr">${r.landlines.map(esc).join('<br>')}</td>
      <td class="p-3 font-mono" dir="ltr">${r.mobiles.map(esc).join('<br>')}</td>
      <td class="p-3 text-slate-500">${esc(r.category)}</td>
      <td class="p-3 text-slate-500" title="${dt(r.first_seen)}">${esc(r.date)}</td>
    </tr>`).join('');
  $('#leads-empty').classList.toggle('hidden', list.length > 0);
  $('#leads-count').textContent = list.length ? `${fa(list.length)} فروشگاه${list.length >= 2000 ? ' (۲۰۰۰ تای اول — برای همه، اکسل را دانلود کنید)' : ''}` : '';
  $('#f-dl').href = '/api/export?' + leadsQuery();
}
$('#f-scope').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filters.scope = b.dataset.v;
  $$('#f-scope button').forEach((x) => x.classList.toggle('on', x === b));
  loadLeads();
};
$('#f-type').onchange = (e) => { filters.type = e.target.value; loadLeads(); };
$('#f-cat').onchange = (e) => { filters.category = e.target.value; loadLeads(); };
$('#f-q').oninput = (e) => { filters.q = e.target.value.trim(); clearTimeout(leadsTimer); leadsTimer = setTimeout(loadLeads, 300); };
$('#f-dl').onclick = () => setTimeout(poll, 1500);

// ================= تاریخچه =================
const STATUS = {
  running: ['bg-sky-100 text-sky-700', 'در حال اجرا'],
  done: ['bg-emerald-100 text-emerald-700', 'کامل'],
  stopped: ['bg-slate-100 text-slate-600', 'متوقف شد'],
  interrupted: ['bg-amber-100 text-amber-700', 'قطع شد'],
  error: ['bg-red-100 text-red-700', 'خطا'],
};
async function loadRuns() {
  const list = await get('runs');
  $('#runs').innerHTML = list.length ? list.map((r) => {
    const s = STATUS[r.status] || STATUS.stopped;
    return `<tr data-run="${r.id}" class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
      <td class="p-3 text-slate-400">${fa(r.id)}</td>
      <td class="p-3 whitespace-nowrap">${dt(r.started_at)}<div class="text-xs text-slate-400">${ago(r.started_at)}</div></td>
      <td class="p-3 whitespace-nowrap">${dur(r.started_at, r.finished_at)}</td>
      <td class="p-3"><span class="chip ${s[0]}">${s[1]}</span></td>
      <td class="p-3">${fa(r.cats_done)}</td>
      <td class="p-3">${fa(r.products_done)}</td>
      <td class="p-3 font-semibold text-emerald-600">${fa(r.new_shops)}</td>
      <td class="p-3">${fa(r.new_phones)}</td>
      <td class="p-3 text-xs text-slate-500">${r.trigger === 'schedule' ? 'خودکار' : 'دستی'}</td>
    </tr>`;
  }).join('') : '<tr><td class="p-6 text-center text-slate-400" colspan="9">هنوز اجرایی نبوده</td></tr>';
}
$('#runs').onclick = async (e) => {
  const tr = e.target.closest('[data-run]'); if (!tr) return;
  const d = await get('runs/' + tr.dataset.run);
  const r = d.run, s = STATUS[r.status] || STATUS.stopped;
  $('#rm-title').innerHTML = `اجرای #${fa(r.id)} <span class="chip ${s[0]}">${s[1]}</span>`;
  $('#rm-summary').textContent = `${dt(r.started_at)} — مدت ${dur(r.started_at, r.finished_at)} · ${fa(r.products_done)} محصول بررسی شد · ${fa(r.new_shops)} فروشگاه جدید · ${fa(r.new_phones)} شماره جدید${r.note ? ' · خطا: ' + r.note : ''}`;
  const why = { known: 'تا محصولات قبلی', max: 'به سقف رسید', end: 'ته لیست' };
  $('#rm-cats').innerHTML = d.categories.map((c) => `<tr class="border-t border-slate-100"><td class="p-2">${esc(c.name)}</td><td class="p-2">${fa(c.seen)}</td><td class="p-2">${fa(c.added)}</td>
    <td class="p-2 text-slate-500">${c.finished_at ? why[c.stop_reason] || 'کامل' : 'نیمه‌کاره'}</td></tr>`).join('') || '<tr><td class="p-2 text-slate-400" colspan="4">فقط کارهای نیمه‌تمام قبلی</td></tr>';
  $('#rm-log').textContent = d.logs.map((l) => `[${new Date(l.ts).toLocaleTimeString('fa-IR', { hour12: false })}] ${l.message}`).join('\n');
  $('#run-modal').classList.remove('hidden');
};

// ================= تنظیمات =================
function renderProxies(list, tests = {}) {
  $('#px-list').innerHTML = list.map((p) => {
    const t = tests[p.url];
    const st = t ? (t.ok ? ['bg-emerald-100 text-emerald-700', '🟢 سالم'] : ['bg-red-100 text-red-700', '🔴 خراب'])
      : p.status === 'dead' ? ['bg-red-100 text-red-700', '🔴 خراب']
      : p.coolingFor > 0 ? ['bg-amber-100 text-amber-700', `🟡 استراحت ${fa(Math.ceil(p.coolingFor / 60000))} دقیقه`]
      : ['bg-emerald-100 text-emerald-700', '🟢 سالم'];
    return `<div class="flex items-center gap-2"><span class="chip ${st[0]}">${st[1]}</span>
      <span dir="ltr" class="font-mono text-slate-500 truncate">${esc(p.url.replace(/^\w+:\/\//, '').slice(0, 40))}…</span>
      ${t?.ip || p.last_ip ? `<span dir="ltr" class="text-slate-400">${esc(t?.ip || p.last_ip)}</span>` : ''}</div>`;
  }).join('') || '<div class="text-slate-400">پروکسی تعریف نشده — بدون پروکسی سایت زود محدود می‌کند</div>';
}
async function loadProxies() {
  const list = await get('proxies');
  $('#px-text').value = list.map((p) => p.url).join('\n');
  renderProxies(list);
}
$('#px-save').onclick = async () => {
  const r = await post('proxies', { text: $('#px-text').value });
  toast(`${fa(r.count)} پروکسی ذخیره شد`);
  loadProxies();
};
$('#px-test').onclick = async () => {
  await post('proxies', { text: $('#px-text').value });
  $('#px-msg').innerHTML = '<span class="spinner"></span> در حال تست…';
  $('#px-test').disabled = true;
  const res = await post('proxies/test');
  $('#px-test').disabled = false;
  $('#px-msg').textContent = `${fa(res.filter((r) => r.ok).length)} از ${fa(res.length)} سالم`;
  renderProxies(await get('proxies'), Object.fromEntries(res.map((r) => [r.url, r])));
};

let settings = {};
async function loadRunSettings() {
  settings = await get('settings');
  $$('#set-speed button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.speed));
  $('#set-max').value = settings.maxPerCategory;
  $('#set-daily').value = settings.dailyAt || '';
}
$('#set-speed').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  settings.speed = b.dataset.v;
  $$('#set-speed button').forEach((x) => x.classList.toggle('on', x === b));
};
$('#set-daily-off').onclick = () => ($('#set-daily').value = '');
$('#set-save').onclick = async () => {
  await post('settings', { speed: settings.speed, maxPerCategory: +$('#set-max').value || 300, dailyAt: $('#set-daily').value });
  toast('تنظیمات ذخیره شد');
};

// ================= شروع =================
loadTree();
poll().then(() => showTab(location.hash.slice(1)));
