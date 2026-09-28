#!/usr/bin/env node
/**
 * Смоук-тест собранного приложения: поднимает vite preview, открывает в headless
 * Chromium с software-WebGL, грузит демо-фигуру и настоящий STL-файл, проверяет
 * пересчёт оптики, переключение проекции и регистрацию service worker.
 *
 *   node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4183;
const URL = `http://127.0.0.1:${PORT}/`;
const EXEC = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome';
const TMP = path.join(ROOT, '.smoke');

const results = [];

/** Под софтверным WebGL кадр идёт ~2 с — ждём кадров, а не миллисекунд. */
async function waitFrames(page, n = 2, timeout = 60000) {
  await page.evaluate(() => {
    window.__frames0 = window.__viewer?.renderer.info.render.frame ?? 0;
  });
  await page.waitForFunction(
    (n) => (window.__viewer?.renderer.info.render.frame ?? 0) >= window.__frames0 + n,
    n,
    { timeout, polling: 250 }
  );
}
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {
      /* ещё не поднялся */
    }
    await sleep(300);
  }
  throw new Error('preview-сервер не ответил');
}

/** Мини-куб в ASCII STL — проверяем настоящий путь загрузки файла. */
function makeSTL() {
  const v = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 5, 1], [0, 4, 5], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  const norm = (a, b, c) => {
    const u = b.map((x, i) => x - a[i]);
    const w = c.map((x, i) => x - a[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  };
  let out = 'solid test_cube\n';
  for (const [a, b, c] of faces) {
    const n = norm(v[a], v[b], v[c]);
    out += `  facet normal ${n.join(' ')}\n    outer loop\n`;
    for (const i of [a, b, c]) out += `      vertex ${v[i].join(' ')}\n`;
    out += '    endloop\n  endfacet\n';
  }
  return `${out}endsolid test_cube\n`;
}

/** Куб с UV + MTL, ссылающийся на текстуру — проверяем резолв соседних файлов. */
function makeObjSet() {
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const uv = [[0,0],[1,0],[1,1],[0,1]];
  const f = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,5,1],[0,4,5],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]];
  let obj = '# текстурированный куб\nmtllib test.mtl\no test_mesh\nusemtl testmat\n';
  for (let i = 0; i < v.length; i++) obj += `v ${v[i].join(' ')}\n`;
  for (let i = 0; i < uv.length; i++) obj += `vt ${uv[i].join(' ')}\n`;
  for (const [a, b, c] of f) obj += `f ${a+1}/${a+1} ${b+1}/${b+1} ${c+1}/${c+1}\n`;
  const mtl = [
    'newmtl testmat', 'Ka 0.2 0.2 0.2', 'Kd 0.9 0.6 0.2', 'Ks 0.4 0.4 0.4', 'Ns 48',
    'map_Kd checker.png', '', '',
  ].join('\n');
  // 4×4 PNG-текстура «шахматка» (пишем минимальный валидный PNG через zlib)
  return { obj, mtl };
}

/** Минимальный PNG 4×4 «шахматка» — zlib из stdlib, без зависимостей. */
function makeCheckerPNG() {
  const zlib = require('node:zlib');
  const W = 4, H = 4;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const on = (x + y) % 2 === 0 ? 230 : 40;
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = on; raw[o + 1] = on; raw[o + 2] = on;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});

let browser;
try {
  await mkdir(TMP, { recursive: true });
  const stl = path.join(TMP, 'test_cube.stl');
  await writeFile(stl, makeSTL());
  const { obj, mtl } = makeObjSet();
  await writeFile(path.join(TMP, 'test.obj'), obj);
  await writeFile(path.join(TMP, 'test.mtl'), mtl);
  await writeFile(path.join(TMP, 'checker.png'), makeCheckerPNG());

  await waitForServer(URL);
  console.log(`\n▶ ${URL}\n`);

  browser = await chromium.launch({
    executablePath: EXEC,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${URL}?debug=1`, { waitUntil: 'load' });
  await sleep(2000);

  /* 1. WebGL поднялся */
  const gl = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return { ok: !!(c.getContext('webgl2') || c.getContext('webgl')), w: c.width, h: c.height };
  });
  check('WebGL-контекст создан', gl.ok, `${gl.w}×${gl.h}`);

  /* 2. Пустое состояние на месте */
  check('Пустое состояние видно', await page.isVisible('#dropzone'));
  check('Панель открыта на десктопе', await page.evaluate(() => document.querySelector('#panel').classList.contains('is-open')));

  /* 3. Демо-фигура грузится */
  await page.click('#demo-shapes button:has-text("Шестерня")');
  await page.waitForFunction(() => window.__viewer?.stats?.meshes > 0, { timeout: 30000, polling: 200 });
  await sleep(1200);
  const afterDemo = await page.evaluate(() => ({
    hidden: document.querySelector('#dropzone').hidden,
    name: document.querySelector('#model-name').textContent,
    tris: document.querySelector('#stat-tris').textContent,
    badge: document.querySelector('#viewport-badge').textContent.replace(/\s+/g, ' ').trim(),
  }));
  check('Демо-фигура отрисована', afterDemo.hidden && /Шестерня/.test(afterDemo.name), afterDemo.name);
  check('Счётчик треугольников живой', /\d/.test(afterDemo.tris), afterDemo.tris);
  check('Бейдж оптики виден', /мм/.test(afterDemo.badge), afterDemo.badge);

  /* 4. Оптика: 50 мм → 200 мм должно сжать FOV */
  const fovBefore = await page.evaluate(() => document.querySelectorAll('.num')[1]?.value);
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.num')];
    const focal = inputs[0];
    focal.value = '200';
    focal.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(400);
  const afterFocal = await page.evaluate(() => ({
    focal: document.querySelectorAll('.num')[0].value,
    fov: document.querySelectorAll('.num')[1].value,
    badge: document.querySelector('#viewport-badge').textContent.replace(/\s+/g, ' ').trim(),
  }));
  check(
    'Фокусное 200 мм ↔ FOV пересчитан',
    Number(afterFocal.focal) === 200 && Number(afterFocal.fov) < Number(fovBefore),
    `fov ${fovBefore}° → ${afterFocal.fov}°`
  );

  /* 5. Смена сенсора держит фокусное и меняет FOV */
  await page.selectOption('.panel select', 'mft');
  await sleep(300);
  const afterSensor = await page.evaluate(() => ({
    focal: document.querySelectorAll('.num')[0].value,
    fov: Number(document.querySelectorAll('.num')[1].value),
  }));
  check(
    'Смена сенсора: фокусное держится, FOV сужается',
    Number(afterSensor.focal) === 200 && afterSensor.fov < Number(afterFocal.fov),
    `fov ${afterFocal.fov}° (FF) → ${afterSensor.fov}° (M 4/3)`
  );
  await page.selectOption('.panel select', 'ff');
  await sleep(200);

  /* 6. Ортокамера */
  await page.click('.panel .seg__btn:has-text("Ортогональная")');
  await sleep(1200);
  const ortho = await page.evaluate(() => ({
    badge: document.querySelector('#viewport-badge').textContent.replace(/\s+/g, ' ').trim(),
    disabled: document.querySelectorAll('.num')[0].disabled,
  }));
  check('Ортокамера включилась', /ортокамера/.test(ortho.badge), ortho.badge);
  check('Поля оптики заблокированы в орторежиме', ortho.disabled === true);
  await page.click('.panel .seg__btn:has-text("Перспектива")');
  await sleep(300);

  /* 7. Настоящий файл через input */
  await page.setInputFiles('#file-input', stl);
  await page.waitForFunction(() => document.querySelector('#model-name').textContent.includes('test_cube'), { timeout: 15000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.dim-label')].filter((e) => e.style.display !== 'none' && e.textContent).length === 3,
    { timeout: 60000, polling: 250 }
  );
  const afterFile = await page.evaluate(() => ({
    name: document.querySelector('#model-name').textContent,
    size: document.querySelector('#stat-size').textContent,
    info: [...document.querySelectorAll('#panel-body .sect:first-child span')].map((s) => s.textContent).join('|'),
    labels: [...document.querySelectorAll('.dim-label')].filter((e) => e.style.display !== 'none').map((e) => e.textContent),
  }));
  check('STL загрузился', afterFile.name.includes('test_cube'), afterFile.name);
  check('Габариты посчитаны', /10/.test(afterFile.info), afterFile.labels.join(' · '));
  check('Подписи размеров на экране', afterFile.labels.length === 3, afterFile.labels.join(' / '));

  /* 7b. OBJ + MTL + текстура из одного drop'а */
  await page.setInputFiles('#file-input', [
    path.join(TMP, 'test.obj'),
    path.join(TMP, 'test.mtl'),
    path.join(TMP, 'checker.png'),
  ]);
  await page.waitForFunction(() => document.querySelector('#model-name').textContent.includes('test.obj'), { timeout: 20000 });
  await sleep(1500);
  const afterObj = await page.evaluate(() => {
    const w = window.__viewer;
    let tex = 0, mat = 0;
    w.modelRoot.traverse((o) => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) { mat++; if (m?.map) tex++; }
    });
    return { stats: w.stats.format, tex, mat, errs: document.querySelectorAll('.toast--err').length };
  });
  check('OBJ загрузился', afterObj.stats === 'OBJ', afterObj.stats);
  check('Текстура подхватилась из drag-n-drop', afterObj.tex > 0, `${afterObj.tex} текстур, материалов: ${afterObj.mat}`);

  /* 8. Ракурсы и тумблеры не ломают сцену */
  await page.keyboard.press('6'); // сверху
  await sleep(300);
  await page.keyboard.press('f'); // вписать
  await sleep(300);
  await page.click('.panel .switch:has(+ *) >> nth=0').catch(() => {});
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#panel-body .row')];
    const wire = rows.find((r) => r.textContent.includes('Каркас'));
    wire?.querySelector('input')?.click();
  });
  await sleep(400);
  check('Сцена жива после ракурсов и тумблеров', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  /* 9. Скриншот PNG */
  const shotLen = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return c.toDataURL('image/png').length;
  });
  check('Кадр читается в PNG', shotLen > 5000, `${Math.round(shotLen / 1024)} КБ base64`);

  /* 10. PWA: манифест, иконки, service worker */
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const res = await fetch(href);
    return res.ok ? res.json() : null;
  });
  check('Манифест отдаётся и валиден', manifest?.name && manifest.icons?.length >= 3, `${manifest?.name}, иконок: ${manifest?.icons?.length}`);

  const iconOk = await page.evaluate(async () => {
    const res = await fetch(new URL('icons/icon-512.png', document.querySelector('link[rel=manifest]').href));
    return res.ok && res.headers.get('content-type')?.includes('png');
  });
  check('Иконка 512 доступна', iconOk);

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { registered: false };
    await navigator.serviceWorker.ready;
    return { registered: true, scope: reg.scope, active: !!reg.active };
  });
  check('Service worker зарегистрирован', sw.registered && sw.active, sw.scope || '');

  const offline = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find((k) => k.includes('precache')) || '');
    return cache ? (await cache.keys()).length : 0;
  });
  check('Precache заполнен', offline > 10, `${offline} записей`);

  /* 11. Ошибок в консоли быть не должно */
  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React/i.test(e));
  check('Консоль чистая', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  const SHOTS = path.join(ROOT, 'screenshots');
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'desktop.png') });

  const mobile = await ctx.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${URL}?debug=1`, { waitUntil: 'load' });
  await sleep(1500);
  await mobile.click('#demo-shapes button:has-text("Ваза")');
  await sleep(1200);
  await mobile.screenshot({ path: path.join(SHOTS, 'mobile.png') });
  await mobile.evaluate(() => document.querySelector('#btn-panel').click());
  await sleep(600);
  await mobile.screenshot({ path: path.join(SHOTS, 'mobile-panel.png') });
  console.log(`\n📸 Скриншоты: ${SHOTS}`);
} catch (err) {
  check('Тест завершился без исключений', false, err.message);
  console.error(err);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
