// خواندن لیدها (هر فروشگاه یک ردیف) + آمار + تاریخچه + خروجی Excel
const ExcelJS = require('exceljs');
const { q, rows, one, tx } = require('./db');

const faDate = (ms) => (ms ? new Date(ms).toLocaleDateString('fa-IR') : '');

async function query({ scope = 'all', type = '', q: search = '', category = '', limit = 0 } = {}) {
  const where = ['EXISTS (SELECT 1 FROM phones p WHERE p.shop_id=s.id)'];
  const args = [];
  const arg = (v) => { args.push(v); return '$' + args.length; };
  if (scope === 'new') where.push('s.exported_at IS NULL');
  if (type) where.push(`EXISTS (SELECT 1 FROM phones p WHERE p.shop_id=s.id AND p.type=${arg(type)})`);
  if (search) { const a = arg(`%${search}%`); where.push(`(s.name ILIKE ${a} OR EXISTS (SELECT 1 FROM phones p WHERE p.shop_id=s.id AND p.phone LIKE ${a}))`); }
  if (category) where.push(`s.category_id IN (WITH RECURSIVE t(id) AS (SELECT ${arg(+category)}::int UNION SELECT c.id FROM categories c JOIN t ON c.parent_id=t.id) SELECT id FROM t)`);
  const r = await rows(`
    SELECT s.id, s.name, s.first_seen, s.exported_at, s.product_url, c.name AS category,
      (SELECT string_agg(phone, ' ' ORDER BY phone) FROM phones p WHERE p.shop_id=s.id AND p.type='mobile') AS mobiles,
      (SELECT string_agg(phone, ' ' ORDER BY phone) FROM phones p WHERE p.shop_id=s.id AND p.type='landline') AS landlines
    FROM shops s LEFT JOIN categories c ON c.id=s.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.first_seen DESC ${limit ? 'LIMIT ' + +limit : ''}`, args);
  return r.map((x) => ({
    ...x,
    mobiles: x.mobiles ? x.mobiles.split(' ') : [],
    landlines: x.landlines ? x.landlines.split(' ') : [],
    shopUrl: x.id > 0 ? `https://torob.com/shop/${x.id}/` : '',
    isNew: !x.exported_at,
    date: faDate(x.first_seen),
  }));
}

async function stats() {
  const r = await one(`SELECT
    (SELECT COUNT(DISTINCT shop_id)::int FROM phones) shops,
    (SELECT COUNT(*)::int FROM phones) phones,
    (SELECT COUNT(*)::int FROM shops s WHERE exported_at IS NULL AND EXISTS (SELECT 1 FROM phones p WHERE p.shop_id=s.id)) "newShops",
    (SELECT COUNT(*)::int FROM products WHERE status='pending') pending,
    (SELECT COUNT(*)::int FROM products) products,
    (SELECT COUNT(*)::int FROM categories WHERE selected) "selectedCats"`);
  r.lastRun = await one(`SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`);
  return r;
}

// تاریخچه اجراها
const runs = (limit = 20) => rows(`
  SELECT r.*, (SELECT COUNT(*)::int FROM run_categories rc WHERE rc.run_id=r.id AND rc.finished_at IS NOT NULL) cats_done
  FROM runs r ORDER BY id DESC LIMIT $1`, [limit]);
const runDetail = async (id) => ({
  run: await one('SELECT * FROM runs WHERE id=$1', [id]),
  categories: await rows(`SELECT rc.*, c.name FROM run_categories rc LEFT JOIN categories c ON c.id=rc.category_id WHERE run_id=$1 ORDER BY started_at`, [id]),
  logs: await rows('SELECT ts, message FROM logs WHERE run_id=$1 ORDER BY id LIMIT 3000', [id]),
});

async function toExcel(list) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('لیدها', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'فروشگاه', key: 'name', width: 30 },
    { header: 'تلفن ثابت', key: 'landlines', width: 22 },
    { header: 'موبایل', key: 'mobiles', width: 22 },
    { header: 'دسته', key: 'category', width: 24 },
    { header: 'تاریخ پیدا شدن', key: 'date', width: 14 },
    { header: 'لینک فروشگاه', key: 'shopUrl', width: 40 },
  ];
  for (const r of list) ws.addRow({ ...r, landlines: r.landlines.join('\n'), mobiles: r.mobiles.join('\n') });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.eachRow((row, i) => { if (i > 1) row.alignment = { wrapText: true, vertical: 'top' }; });
  ws.autoFilter = { from: 'A1', to: 'F1' };
  return wb.xlsx.writeBuffer();
}

const markExported = (ids) => ids.length && q('UPDATE shops SET exported_at=$1 WHERE id = ANY($2::bigint[])', [Date.now(), ids]);

// وضعیت هر دسته (انتخاب‌شده یا قبلاً اسکن‌شده) برای داشبورد
const categoryStatus = () => rows(`
  SELECT c.id, c.name, par.name AS parent, c.selected,
    cs.full_scan_done, cs.first_scan_at, cs.last_scan_at,
    COALESCE(p.total,0) total, COALESCE(p.pending,0) pending, COALESCE(p.done,0) done, COALESCE(p.no_inperson,0) no_inperson, COALESCE(p.error,0) error,
    COALESCE(s.shops,0) shops, COALESCE(s.new_shops,0) new_shops, COALESCE(s.phones,0) phones, s.last_lead_at,
    lr.added AS last_added, lr.stop_reason AS last_stop_reason, lr.finished_at AS last_finished_at
  FROM categories c
  LEFT JOIN categories par ON par.id=c.parent_id
  LEFT JOIN category_state cs ON cs.category_id=c.id
  LEFT JOIN LATERAL (SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE status='pending')::int pending, COUNT(*) FILTER (WHERE status='done')::int done,
      COUNT(*) FILTER (WHERE status='no_inperson')::int no_inperson, COUNT(*) FILTER (WHERE status='error')::int error
    FROM products WHERE category_id=c.id) p ON true
  LEFT JOIN LATERAL (SELECT COUNT(*)::int shops,
      COUNT(*) FILTER (WHERE exported_at IS NULL)::int new_shops,
      (SELECT COUNT(*)::int FROM phones ph JOIN shops s2 ON s2.id=ph.shop_id WHERE s2.category_id=c.id) phones,
      MAX(first_seen) last_lead_at
    FROM shops WHERE category_id=c.id AND EXISTS (SELECT 1 FROM phones x WHERE x.shop_id=shops.id)) s ON true
  LEFT JOIN LATERAL (SELECT added, stop_reason, finished_at FROM run_categories WHERE category_id=c.id AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) lr ON true
  WHERE c.selected OR p.total > 0
  ORDER BY c.selected DESC, c.sort`);

module.exports = { query, stats, runs, runDetail, toExcel, markExported, categoryStatus };
