// کشف درخت دسته‌ها از منوی ترب
// دسته‌های اصلی: دکمه منو → عنوان‌ها (catsMenu_subtitle) → زیرشاخه‌ها (catsMenu_grayhover)
// «سایر دسته‌ها»: هر subtitle خودش یک دسته اصلی است
const TOPS = ['موبایل و کالای دیجیتال', 'لپ‌تاپ، کامپیوتر، اداری', 'هایپر مارکت', 'لوازم خانگی', 'مد و پوشاک', 'زیبایی و بهداشت', 'صوتی و تصویری'];
const TOP_IDS = { 'موبایل و کالای دیجیتال': 175, 'لپ‌تاپ، کامپیوتر، اداری': 173, 'هایپر مارکت': 179, 'لوازم خانگی': 169, 'مد و پوشاک': 176, 'زیبایی و بهداشت': 171, 'صوتی و تصویری': 174 };

const readMenu = (page) =>
  page.$$eval('a[class*="catsMenu"][href*="/browse/"]', (as) =>
    as.filter((a) => !a.getAttribute('href').includes('/b/')).map((a) => ({ id: +a.getAttribute('href').split('/')[2], name: a.innerText.trim(), kind: /subtitle/.test(a.className) ? 'sub' : /grayhover/.test(a.className) ? 'leaf' : 'other' }))
  );

// [{kind,...}] → [{id,name,children}] با گروه‌بندی هر sub با leafهای بعدش
function group(items) {
  const out = [];
  let cur = null;
  for (const it of items) {
    if (!it.id || !it.name) continue;
    if (it.kind === 'sub') { cur = { id: it.id, name: it.name, children: [] }; out.push(cur); }
    else if (it.kind === 'leaf' && cur && it.id !== cur.id && !cur.children.some((c) => c.id === it.id)) cur.children.push({ id: it.id, name: it.name });
  }
  return out;
}

async function discover(bm) {
  const page = await bm.goto('https://torob.com/');
  const tree = [];
  const seen = new Set();
  for (const t of TOPS) {
    await page.getByRole('button', { name: t, exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    const children = group(await readMenu(page)).filter((g) => !seen.has(g.id));
    await page.keyboard.press('Escape').catch(() => {});
    // منوی باز ممکن است subtitle دسته اصلی دیگری باشد؛ فقط وقتی معتبر است که چیزی پیدا شده
    tree.push({ id: TOP_IDS[t], name: t, children });
    seen.add(TOP_IDS[t]);
    children.forEach((c) => seen.add(c.id));
  }
  await page.getByText('سایر دسته‌ها', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2000);
  for (const g of group(await readMenu(page))) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    tree.push(g);
  }
  return tree;
}

module.exports = { discover };
