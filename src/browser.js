// مرورگر Patchright + چرخش پروکسی
const { chromium } = require('patchright');
const path = require('path');
const fs = require('fs');
const { PROFILES_DIR, HEADLESS, CHROMIUM, CITY_ID, CITY_NAME } = require('./config');
const proxies = require('./proxies');
const { log } = require('./log');

class CaptchaError extends Error {}
class ShadowBanError extends Error {}
class StopError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BrowserManager {
  constructor(shouldStop = () => false, onWait = () => {}) {
    this.ctx = null;
    this.page = null;
    this.proxy = null; // ردیف جدول proxies یا null (بدون پروکسی)
    this.shouldStop = shouldStop;
    this.onWait = onWait;
  }

  // مرورگر را (در صورت نیاز) با یک پروکسی سالم باز می‌کند
  async ensure() {
    if (this.page && !this.page.isClosed()) return this.page;
    let proxy = null;
    if (await proxies.count()) {
      // همه در استراحت → صبر تا اولین پروکسی آزاد شود
      while (!(proxy = await proxies.pick())) {
        if (this.shouldStop()) throw new StopError();
        const t = +(await proxies.nextAvailableAt()) || 0;
        if (!t) throw new Error('هیچ پروکسی سالمی نمانده — پروکسی جدید اضافه کنید');
        const mins = Math.max(1, Math.ceil((t - Date.now()) / 60000));
        this.onWait(`همه پروکسی‌ها موقتاً محدود شده‌اند — حدود ${mins} دقیقه دیگر خودکار ادامه می‌دهیم`);
        await sleep(Math.min(30000, Math.max(1000, t - Date.now())));
      }
      this.onWait(null);
    }
    this.proxy = proxy;
    const profile = path.join(PROFILES_DIR, proxy ? 'p' + proxy.sort : 'direct');
    fs.mkdirSync(profile, { recursive: true });
    log('باز کردن مرورگر', proxy ? 'با پروکسی ' + proxy.url.replace(/^\w+:\/\//, '').slice(0, 14) : 'بدون پروکسی');
    this.ctx = await chromium.launchPersistentContext(profile, {
      headless: HEADLESS,
      viewport: HEADLESS ? { width: 1366, height: 900 } : null,
      executablePath: CHROMIUM,
      ...(proxy ? { proxy: { server: proxy.url } } : {}),
    });
    await this.ctx.addCookies([
      { name: 'deliver_city', value: CITY_ID, domain: '.torob.com', path: '/' },
      { name: 'deliver_city_obj', value: encodeURIComponent(JSON.stringify({ id: CITY_ID, name: CITY_NAME })), domain: '.torob.com', path: '/' },
    ]);
    this.page = this.ctx.pages()[0] || (await this.ctx.newPage());
    // هر تب اضافه (مثلاً سایت فروشگاه) فوراً بسته شود
    this.ctx.on('page', (p) => p !== this.page && p.close().catch(() => {}));
    return this.page;
  }

  async close() {
    const ctx = this.ctx;
    this.ctx = this.page = null;
    if (ctx) await ctx.close().catch(() => {});
  }

  // پروکسی فعلی را علامت می‌زند و مرورگر را با پروکسی بعدی باز می‌کند
  async rotate(reason) {
    if (this.proxy) await proxies.mark(this.proxy.url, reason);
    await this.close();
    if (!this.proxy && reason !== 'fail') {
      // بدون پروکسی کاری جز صبر نمی‌شود کرد
      this.onWait(reason === 'captcha' ? 'سایت کپچا داد و پروکسی تعریف نشده — چند دقیقه صبر می‌کنیم' : 'سایت شماره‌ها را محدود کرد و پروکسی تعریف نشده — چند دقیقه صبر می‌کنیم');
      for (let i = 0; i < 60 && !this.shouldStop(); i++) await sleep(5000);
      this.onWait(null);
    }
    return this.ensure();
  }

  // رفتن به آدرس با تشخیص کپچا و خطای پروکسی
  async goto(url) {
    const page = await this.ensure();
    let res;
    try {
      res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      if (/ERR_PROXY|ERR_TUNNEL|ERR_CONNECTION|ERR_TIMED_OUT|Timeout/i.test(e.message)) {
        throw new Error('proxy-fail'); // withRetry → rotate('fail')
      }
      throw e;
    }
    const title = await page.title().catch(() => '');
    if (res?.status() === 490 || title.includes('ربات')) throw new CaptchaError();
    // 429 = محدودیت تعداد درخواست → مثل کپچا: پروکسی عوض شود و همان صفحه دوباره
    if (res?.status() === 429 || /too many requests/i.test(title)) { const e = new CaptchaError(); e.rateLimit = true; throw e; }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    if (this.proxy) proxies.mark(this.proxy.url, 'ok').catch(() => {});
    return page;
  }
}

// تست یک پروکسی با مرورگر واقعی → IP خروجی یا خطا
async function testProxy(url) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM, proxy: { server: url } });
    const page = await browser.newPage();
    await page.goto('https://api.ipify.org', { timeout: 30000 });
    const ip = (await page.innerText('body')).trim();
    return { ok: /^[\d.:a-f]+$/i.test(ip), ip };
  } catch (e) {
    return { ok: false, error: e.message.split('\n')[0].slice(0, 80) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { BrowserManager, CaptchaError, ShadowBanError, StopError, testProxy, sleep };
