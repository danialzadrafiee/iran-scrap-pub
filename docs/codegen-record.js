const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://torob.com/');
  await page.getByRole('button', { name: 'موبایل و کالای دیجیتال' }).click();
  await page.getByRole('link', { name: 'موبایل و کالای دیجیتال' }).click();
  await page.locator('#main-content').click();
  await page.getByRole('link', { name: 'گوشی سامسونگ (ویتنام) A36 5G | حافظه 128 رم 8 گیگابایت', exact: true }).click();
  await page.getByRole('tab', { name: 'خرید حضوری ۱۵۹' }).click();
  await page.getByRole('main').click();
  await page.getByRole('region', { name: 'شهر‌های پربازدید' }).getByRole('button', { name: 'تهران' }).click();
  await page.getByRole('tab', { name: 'خرید حضوری ۲۷' }).click();
  await page.getByRole('main').click();
  await page.getByText('اطلاعات تماس').nth(1).click();
  await page.getByText('نمایش تمام ۲۷ فروشگاه').click();
  await page.getByText('اطلاعات تماس').nth(5).click();
  await page.getByRole('button', { name: 'لپ‌تاپ، کامپیوتر، اداری' }).click();
  await page.getByRole('link', { name: 'لپ‌تاپ، کامپیوتر، اداری' }).click();
  await page.getByRole('link', { name: 'پکیج ۸ عددی دوربین مداربسته فول اچ دی با تشخیص چهره مناسب کارخانه و ساختمان', exact: true }).click();
  await page.getByRole('main').click();
  await page.getByText('نمایش تمام ۱۸ فروشگاه').click();
  await page.locator('#list-1-c1b417b8-2603-435a-bf0c-68ded3b4acc6 > div:nth-child(2) > .ReactCollapse--collapse > .ReactCollapse--content > div > .inStoreSellerCard_purchaseInfo___u3I1 > .inStoreSellerCard_buyBtnWrapper__1wKy5 > .inStoreSellerCard_buyBtn__HUP3h').first().click();
  await page.getByRole('button', { name: 'هایپر مارکت' }).click();
  await page.getByRole('link', { name: 'هایپر مارکت' }).click();
  await page.getByRole('link', { name: 'دمنوش شاهتره مصفی خون ستین دکتر بیز 120 عددی', exact: true }).click();
  await page.getByRole('main').click();
  await page.getByText('نمایش تمام ۶۷ فروشگاه').click();

  // ---------------------
  await context.close();
  await browser.close();
})();