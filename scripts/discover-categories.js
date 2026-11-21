// یک‌بار: ساخت assets/categories.json از منوی ترب
// استفاده: node scripts/discover-categories.js   (از proxies.txt اگر باشد)
const fs = require('fs');
const path = require('path');
const proxies = require('../src/proxies');
const { BrowserManager } = require('../src/browser');
const { discover } = require('../src/categories');
(async () => {
  const pf = path.join(__dirname, '../proxies.txt');
  await require('../src/db').init();
  if (!(await proxies.count()) && fs.existsSync(pf)) await proxies.setFromText(fs.readFileSync(pf, 'utf8'));
  const bm = new BrowserManager();
  try {
    const tree = await discover(bm);
    fs.writeFileSync(path.join(__dirname, '../assets/categories.json'), JSON.stringify(tree, null, 1));
    const count = (n) => n.reduce((s, x) => s + 1 + count(x.children || []), 0);
    console.log('tops', tree.length, 'total', count(tree));
    for (const t of tree.slice(0, 9)) console.log(t.id, t.name, (t.children || []).length, (t.children || []).slice(0, 2).map((c) => c.name + '(' + (c.children || []).length + ')').join(','));
  } finally { await bm.close(); await require('../src/db').pool.end(); }
})();
