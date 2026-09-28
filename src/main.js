import './styles.css';
import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { ModelLoader, isModelFile, collectStats, SUPPORTED_EXT } from './loaders.js';
import { buildPanel, fmtBytes } from './ui.js';
import { DEMO_SHAPES, buildDemoShape } from './demo.js';
import { registerPWA } from './pwa.js';
import { fmtFocal, fmtFov } from './optics.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  stage: $('.stage'),
  canvas: $('#view'),
  labels: $('#labels'),
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  panel: $('#panel'),
  panelBody: $('#panel-body'),
  badge: $('#viewport-badge'),
  progress: $('#progress'),
  progressBar: $('#progress-bar'),
  progressLabel: $('#progress-label'),
  modelName: $('#model-name'),
  statFps: $('#stat-fps'),
  statTris: $('#stat-tris'),
  statSize: $('#stat-size'),
  statHint: $('#stat-hint'),
  toastHost: $('#toast-host'),
  help: $('#help'),
  demoShapes: $('#demo-shapes'),
  btnRotate: $('#btn-rotate'),
  btnFit: $('#btn-fit'),
  btnShot: $('#btn-shot'),
  btnOpen: $('#btn-open'),
  btnPanel: $('#btn-panel'),
  btnPick: $('#btn-pick'),
};

const viewer = new Viewer({ canvas: el.canvas, labels: el.labels, stage: el.stage });
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  window.__viewer = viewer;
  window.__THREE = THREE;
}
const loader = new ModelLoader(viewer.renderer);

/* ──────────── тосты ──────────── */
let toastTimer = 0;
function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast${kind ? ` toast--${kind}` : ''}`;
  node.textContent = message;
  el.toastHost.append(node);
  clearTimeout(toastTimer);
  setTimeout(() => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 260);
  }, kind === 'err' ? 5200 : 3200);
}

/* ──────────── прогресс ──────────── */
function progress(loaded, total, label) {
  el.progressLabel.textContent = label;
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  el.progressBar.style.width = pct != null ? `${pct}%` : '35%';
  el.progressBar.style.transition = pct != null ? 'width .2s' : 'width 1.2s ease-in-out';
}
const hideProgress = () => (el.progress.hidden = true);
const showProgress = () => (el.progress.hidden = false);

/* ──────────── загрузка ──────────── */
async function handleFiles(fileList) {
  const files = [...fileList].filter(Boolean);
  if (!files.length) return;

  const modelFile = files.find(isModelFile);
  if (!modelFile) {
    toast(`Нужен файл модели: ${SUPPORTED_EXT.map((e) => '.' + e).join(', ')}`, 'err');
    return;
  }

  showProgress();
  progress(0, 0, `Читаю ${modelFile.name}`);
  try {
    const siblings = files.filter((f) => f !== modelFile);
    const { object, stats } = await loader.load(modelFile, siblings, progress);
    viewer.setModel(object, stats);
    onModelLoaded(stats);
    toast(`Загружено: ${stats.name} · ${stats.triangles.toLocaleString('ru-RU')} треугольников`, 'ok');
  } catch (err) {
    console.error(err);
    toast(`Не удалось открыть файл: ${err.message || err}`, 'err');
  } finally {
    hideProgress();
  }
}

function loadDemo(id) {
  const shape = DEMO_SHAPES.find((d) => d.id === id) || DEMO_SHAPES[0];
  const object = buildDemoShape(shape.id);
  const stats = collectStats(object, { name: `Фигура «${shape.label}»`, size: 0 }, 'demo');
  stats.unit = 'm';
  stats.unitFactor = 1;
  stats.unitGuessed = false;
  viewer.setModel(object, stats);
  onModelLoaded(stats);
  viewer.setView('iso');
}

function onModelLoaded(stats) {
  el.dropzone.hidden = true;
  el.modelName.textContent = stats.name;
  el.modelName.title = stats.name;
  el.statSize.textContent = stats.size
    ? `${stats.format} · ${fmtBytes(stats.size)}`
    : `${stats.format} · демо-фигура`;
  panel.updateModelInfo(stats);
  el.badge.hidden = false;
  updateBadge();
}

/* ──────────── панель ──────────── */
const panel = buildPanel(el.panelBody, viewer, {
  openFile: () => el.fileInput.click(),
  screenshot: (transparent) => takeScreenshot(transparent),
});

function updateBadge() {
  const isPersp = viewer.getProjection() === 'perspective';
  el.badge.querySelector('[data-focal]').textContent = isPersp ? fmtFocal(viewer.getFocal()) : 'ортокамера';
  el.badge.querySelector('[data-fov]').textContent = isPersp ? fmtFov(viewer.getFov()) : `${Math.round(viewer.ortho.zoom * 100)}%`;
  el.badge.querySelector('[data-projection]').textContent = isPersp ? 'перспектива' : 'параллельные лучи';
  el.statHint.textContent =
    viewer.state.wheelMode === 'focal'
      ? 'ЛКМ — вращение · ПКМ — панорама · колесо — фокусное (Ctrl+колесо — наезд)'
      : 'ЛКМ — вращение · ПКМ — панорама · колесо — наезд';
}

/* ──────────── статус-бар ──────────── */
viewer.on('fps', ({ fps, calls, triangles }) => {
  el.statFps.textContent = `${fps} fps`;
  el.statTris.textContent = `${triangles.toLocaleString('ru-RU')} тр · ${calls} вызовов`;
});
viewer.on('change', () => {
  updateBadge();
  el.btnRotate.classList.toggle('is-active', viewer.state.autoRotate);
});
viewer.on('notice', (msg) => toast(msg));
viewer.on('error', (msg) => toast(msg, 'err'));

/* ──────────── кнопки ──────────── */
el.btnOpen.addEventListener('click', () => el.fileInput.click());
el.btnPick.addEventListener('click', () => el.fileInput.click());
el.btnFit.addEventListener('click', () => viewer.fit());
el.btnRotate.addEventListener('click', () => viewer.setAutoRotate(!viewer.state.autoRotate));
el.btnShot.addEventListener('click', () => takeScreenshot(false));

function takeScreenshot(transparent) {
  try {
    const url = viewer.screenshot({ transparent });
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `3d-view-${stamp}.png`;
    a.click();
    toast('Кадр сохранён в PNG', 'ok');
  } catch (err) {
    console.error(err);
    toast('Не удалось сохранить кадр', 'err');
  }
}

function togglePanel(force) {
  const open = force ?? !el.panel.classList.contains('is-open');
  el.panel.classList.toggle('is-open', open);
  syncFraming();
  setTimeout(syncFraming, 320); // после завершения анимации сдвига
}

/** Сдвиг кадра под ширину открытой панели — модель центрируется в видимой области. */
function syncFraming() {
  const open = el.panel.classList.contains('is-open') && window.innerWidth > 760;
  viewer.setFraming({ panelWidthPx: open ? el.panel.offsetWidth + 20 : 0 });
}
window.addEventListener('resize', () => setTimeout(syncFraming, 50));
$('#btn-panel-close').addEventListener('click', () => togglePanel(false));
el.btnPanel.addEventListener('click', () => togglePanel());
if (window.innerWidth > 760) togglePanel(true);
else syncFraming();

/* ──────────── файлы / drag-n-drop ──────────── */
el.fileInput.addEventListener('change', () => {
  handleFiles(el.fileInput.files);
  el.fileInput.value = '';
});

let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  el.stage.classList.add('is-drag');
});
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.stage.classList.remove('is-drag');
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  el.stage.classList.remove('is-drag');
  handleFiles(e.dataTransfer.files);
});

/* ──────────── демо-фигуры ──────────── */
el.demoShapes.append(
  ...DEMO_SHAPES.map((d) =>
    Object.assign(document.createElement('button'), {
      className: 'chip',
      type: 'button',
      textContent: d.label,
      onclick: () => loadDemo(d.id),
    })
  )
);

/* ──────────── клавиатура ──────────── */
const isTyping = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && el.panel.classList.contains('is-open')) return togglePanel(false);
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;

  const k = e.key.toLowerCase();
  const map = {
    f: () => viewer.fit(),
    r: () => viewer.reset(),
    w: () => viewer.setWireframe(!viewer.state.wireframe),
    c: () => viewer.setClay(!viewer.state.clay),
    e: () => viewer.setEdges(!viewer.state.edges),
    g: () => viewer.setGrid(!viewer.state.grid),
    x: () => viewer.setAxes(!viewer.state.axes),
    d: () => viewer.setDimsVisible(!viewer.state.dims),
    l: () => viewer.setGround(!viewer.state.ground),
    o: () => el.fileInput.click(),
    s: () => takeScreenshot(false),
    ' ': () => viewer.setAutoRotate(!viewer.state.autoRotate),
    '[': () => viewer.stepFocal(-5),
    ']': () => viewer.stepFocal(5),
    '?': () => el.help.showModal(),
    '/': () => el.help.showModal(),
    tab: () => togglePanel(),
    1: () => viewer.setView('iso'),
    2: () => viewer.setView('front'),
    3: () => viewer.setView('back'),
    4: () => viewer.setView('left'),
    5: () => viewer.setView('right'),
    6: () => viewer.setView('top'),
  };

  const fn = map[k];
  if (!fn) return;
  e.preventDefault();
  fn();
});

$('#help-close').addEventListener('click', () => el.help.close());
el.help.addEventListener('click', (e) => {
  if (e.target === el.help) el.help.close();
});
$('#btn-help').addEventListener('click', () => el.help.showModal());

/* ──────────── PWA ──────────── */
const installBtn = document.createElement('button');
installBtn.className = 'btn btn--icon';
installBtn.title = 'Установить приложение';
installBtn.hidden = true;
installBtn.innerHTML =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
document.querySelector('.topbar__actions').prepend(installBtn);

registerPWA({
  onUpdate: (applyUpdate) => {
    const node = document.createElement('div');
    node.className = 'toast toast--ok';
    node.style.pointerEvents = 'auto';
    node.innerHTML = 'Досталось обновление. <button class="btn" style="height:24px;padding:0 8px;margin-left:8px">Обновить</button>';
    node.querySelector('button').addEventListener('click', () => applyUpdate());
    el.toastHost.append(node);
  },
  onOffline: () => toast('Готово — приложение теперь работает офлайн', 'ok'),
  onOnline: () => toast('Сеть вернулась', 'ok'),
  onInstalled: (prompt) => {
    installBtn.hidden = false;
    installBtn.addEventListener('click', async () => {
      if (await prompt()) {
        installBtn.hidden = true;
        toast('Установлено — иконка теперь на рабочем столе', 'ok');
      }
    });
  },
});

/* Ярлык из манифеста: открыть выбор файла сразу */
if (new URLSearchParams(location.search).get('action') === 'open') {
  setTimeout(() => el.fileInput.click(), 400);
}

updateBadge();
console.info('%cФокус 3D', 'font:600 14px sans-serif;color:#4c8dff', '— модель целиком в памяти браузера, ничего не отправляется на сервер');
