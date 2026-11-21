// تنظیمات ثابت و مسیرها
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// پیدا کردن Chromium نصب‌شده توسط Playwright (لوکال یا ایمیج داکر)
function findChromium() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', path.join(os.homedir(), '.cache/ms-playwright')].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const dirs = fs.readdirSync(r).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
    for (const d of dirs) {
      for (const sub of ['chrome-linux64', 'chrome-linux']) {
        const p = path.join(r, d, sub, 'chrome');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return undefined; // patchright خودش دنبال مرورگر می‌گردد
}

module.exports = {
  ROOT,
  DATA_DIR,
  PROFILES_DIR: path.join(DATA_DIR, 'profiles'),
  PORT: +process.env.PORT || 3001,
  HEADLESS: process.env.HEADLESS !== '0',
  CHROMIUM: findChromium(),

  CITY_ID: '392',
  CITY_NAME: 'تهران',

  // dedupe: بعد از این تعداد محصول تکراری پشت‌سرهم، دسته تمام است
  KNOWN_STREAK_STOP: 30,
  // پروکسی
  COOLDOWN_CAPTCHA_MS: 10 * 60 * 1000,
  COOLDOWN_SHADOWBAN_MS: 60 * 60 * 1000,
  PROXY_MAX_FAILS: 3,
  // تاخیر بین صفحه‌ها (میلی‌ثانیه) بر اساس سرعت
  SPEED: {
    slow: { page: [8000, 15000], click: [1000, 2000] },
    normal: { page: [4000, 8000], click: [600, 1200] },
  },
  DEFAULT_SETTINGS: { speed: 'normal', maxPerCategory: '300', dailyAt: '' },
};
