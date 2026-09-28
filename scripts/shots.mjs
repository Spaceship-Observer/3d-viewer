#!/usr/bin/env node
/**
 * Снимает контрольные кадры (нужен браузер: CHROME_PATH или playwright-кэш).
 *   node scripts/shots.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const PORT = 4190, BASE = `http://127.0.0.1:${PORT}/`;
const EXEC = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';
await mkdir('screenshots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], { cwd: process.cwd(), stdio: 'ignore' });
await sleep(2500);
const browser = await chromium.launch({ executablePath: EXEC,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'load' });
await sleep(2500);
await page.screenshot({ path: 'screenshots/empty.png' });

await page.click('#demo-shapes button:has-text("Шестерня")');
await sleep(8000);
await page.screenshot({ path: 'screenshots/desktop.png' });

await page.evaluate(() => { const i = document.querySelectorAll('.num')[0]; i.value = '200'; i.dispatchEvent(new Event('change', { bubbles: true })); });
await sleep(7000);
await page.screenshot({ path: 'screenshots/tele200.png' });

await page.click('.panel .seg__btn:has-text("Ортогональная")');
await sleep(7000);
await page.screenshot({ path: 'screenshots/ortho.png' });
await page.close();

const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(BASE, { waitUntil: 'load', timeout: 120000 });
await sleep(2000);
await m.click('#demo-shapes button:has-text("Ваза")');
await sleep(7000);
await m.screenshot({ path: 'screenshots/mobile.png' });
await m.evaluate(() => document.querySelector('#btn-panel').click());
await sleep(5000);
await m.screenshot({ path: 'screenshots/mobile-panel.png' });

await browser.close(); server.kill('SIGTERM');
console.log('кадры в ./screenshots');
