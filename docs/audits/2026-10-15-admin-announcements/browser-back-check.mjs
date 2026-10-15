// 运行前配置 ANNOUNCEMENT_BASE，目标应为已有至少 21 条公告的本地测试服务。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const base = process.env.ANNOUNCEMENT_BASE;
if (!base) throw Error('Set ANNOUNCEMENT_BASE to a local test server');
const browser = await chromium.launch({ headless: true, channel: 'chrome', ignoreDefaultArgs: ['--disable-back-forward-cache'] });
try {
 const page = await browser.newPage();
 await page.addInitScript(() => { addEventListener('pageshow', e => { window.__cachedReturn = e.persisted; }); });
 await page.goto(base + '/announcements.html'); await page.locator('.announcement-row').first().waitFor();
 await page.getByRole('link', { name: '阅读全文 →', exact: true }).first().click(); await page.locator('.announcement-text').waitFor();
 await page.goBack({ waitUntil: 'commit' }); await page.locator('.announcement-row').first().waitFor();
 const cached = await page.evaluate(() => window.__cachedReturn);
 const more = page.getByRole('button', { name: '加载更多', exact: true }); await more.click();
 await more.waitFor({ state: 'detached', timeout: 3000 });
 assert.ok(await page.locator('.announcement-row').count() > 20);
 console.log(JSON.stringify({ cachedReturn: cached, backThenPagination: 'passed' }));
} finally { await browser.close(); }
