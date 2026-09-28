import {
  SENSORS,
  FOCAL_MIN,
  FOCAL_MAX,
  FOV_MIN,
  FOV_MAX,
  focalToSlider,
  sliderToFocal,
  fmtFocal,
  fmtFov,
} from './optics.js';

/* ──────────── крошечный DOM-хелпер ──────────── */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

const section = (title) => {
  const body = h('div');
  return { el: h('div', { class: 'sect' }, h('h3', { class: 'sect__title', text: title }), body), body };
};

function row(label, control) {
  return h('div', { class: 'row' }, label ? h('span', { class: 'row__label', text: label }) : null, control);
}

function seg(options, value, onChange) {
  const wrap = h('div', { class: 'seg' });
  const buttons = options.map((o) =>
    h('button', {
      class: `seg__btn${o.value === value ? ' is-active' : ''}`,
      type: 'button',
      text: o.label,
      title: o.title || o.label,
      onclick: () => {
        buttons.forEach((b) => b.classList.remove('is-active'));
        const i = options.findIndex((x) => x.value === o.value);
        buttons[i].classList.add('is-active');
        onChange(o.value);
      },
    })
  );
  buttons.forEach((b) => wrap.append(b));
  return {
    el: wrap,
    set(v) {
      buttons.forEach((b, i) => b.classList.toggle('is-active', options[i].value === v));
    },
  };
}

function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' })), input, set: (v) => (input.checked = !!v) };
}

function switchRow(label, checked, onChange) {
  const t = toggle(checked, onChange);
  const el = h('div', { class: 'row' }, h('span', { class: 'row__label', text: label }), t.el);
  return { el, set: t.set };
}

function num(value, onChange, { min, max, step = 1, width } = {}) {
  const input = h('input', {
    class: 'num',
    type: 'number',
    value: String(value),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    step,
    ...(width ? { style: `width:${width}px` } : {}),
  });
  const commit = () => {
    let v = parseFloat(input.value);
    if (!isFinite(v)) return;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    input.value = String(Math.round(v * 100) / 100);
    onChange(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && commit());
  return { el: input, set: (v) => { if (document.activeElement !== input) input.value = String(Math.round(v * 100) / 100); } };
}

function slider({ min, max, step, value, onInput, format }) {
  const input = h('input', { class: 'range', type: 'range', min, max, step, value });
  const out = h('span', { class: 'row__value' });
  const sync = (v) => (out.textContent = format ? format(v) : String(v));
  sync(parseFloat(input.value));
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    sync(v);
    onInput(v);
  });
  const mark = () => (input.dataset.dragging = '1');
  const unmark = () => delete input.dataset.dragging;
  input.addEventListener('pointerdown', mark);
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((ev) => input.addEventListener(ev, unmark));

  return {
    input,
    el: h('div', { class: 'row' }, input, out),
    set(v) {
      if (input.dataset.dragging === '1') return;
      input.value = String(v);
      sync(v);
    },
  };
}

const chipRow = (labels, onPick) => {
  const wrap = h('div', { class: 'chips' });
  const buttons = labels.map((l) =>
    h('button', { class: 'chip', type: 'button', text: l, onclick: () => onPick(l) })
  );
  buttons.forEach((b) => wrap.append(b));
  return { el: wrap, setActive(v) { buttons.forEach((b) => b.classList.toggle('is-active', b.textContent === v)); } };
};

const infoGrid = () => {
  const dl = h('div', {
    class: 'row',
    style: 'display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;margin-bottom:8px',
  });
  const set = (pairs) => {
    dl.textContent = '';
    for (const [k, v] of pairs) {
      dl.append(
        h('span', { style: 'color:var(--txt-faint)', text: k }),
        h('span', { style: 'text-align:right;font-variant-numeric:tabular-nums', text: v })
      );
    }
  };
  set([['Модель', '—']]);
  return { el: dl, set };
};

/* ──────────── панель ──────────── */
export function buildPanel(root, viewer, actions) {
  const s = viewer.state;
  const ctl = {};

  /* Модель */
  const model = section('Модель');
  const info = infoGrid();
  const modelNote = h('p', { class: 'note', hidden: 'hidden' });
  const openBtn = h('button', {
    class: 'btn btn--primary',
    type: 'button',
    text: 'Открыть файл…',
    style: 'width:100%',
    onclick: actions.openFile,
  });
  model.body.append(openBtn, h('div', { style: 'height:11px' }), info.el, modelNote);

  /* Оптика */
  const optics = section('Оптика');
  ctl.projection = seg(
    [
      { value: 'perspective', label: 'Перспектива', title: 'Обычная камера (FOV)' },
      { value: 'ortho', label: 'Ортогональная', title: 'Технический чертёж, параллельные лучи' },
    ],
    s.projection,
    (v) => viewer.setProjection(v)
  );
  optics.body.append(row('Проекция', ctl.projection.el));

  ctl.focal = num(viewer.getFocal(), (v) => viewer.setFocal(v), {
    min: FOCAL_MIN,
    max: FOCAL_MAX,
    step: 1,
  });
  ctl.focalSlider = slider({
    min: 0,
    max: 1000,
    step: 1,
    value: focalToSlider(viewer.getFocal()),
    format: (v) => fmtFocal(sliderToFocal(v)),
    onInput: (v) => viewer.setFocal(sliderToFocal(v)),
  });
  optics.body.append(
    row('Фокусное', ctl.focal.el),
    ctl.focalSlider.el,
    h(
      'div',
      { class: 'row row--wrap', style: 'gap:5px;margin:-2px 0 10px' },
      chipRow(['12', '24', '35', '50', '85', '135', '200'], (mm) => viewer.setFocal(parseFloat(mm))).el
    )
  );

  ctl.fov = num(viewer.getFov(), (v) => viewer.setFov(v), { min: FOV_MIN, max: FOV_MAX, step: 0.1, width: 58 });
  ctl.fovSlider = slider({
    min: FOV_MIN,
    max: FOV_MAX,
    step: 0.1,
    value: viewer.getFov(),
    format: (v) => fmtFov(v),
    onInput: (v) => viewer.setFov(v),
  });
  optics.body.append(row('Угол поля зрения', ctl.fov.el), ctl.fovSlider.el);

  const sensorSelect = h('select', { class: 'num', style: 'width:130px' },
    SENSORS.map((sn) => h('option', { value: sn.id, ...(sn.id === s.sensor.id ? { selected: 'selected' } : {}) }, sn.label))
  );
  sensorSelect.addEventListener('change', () => {
    const sn = SENSORS.find((x) => x.id === sensorSelect.value);
    viewer.applySensor({ ...sn });
  });
  optics.body.append(row('Сенсор', sensorSelect));

  ctl.sensorW = num(s.sensor.w, (v) => viewer.applySensor({ ...viewer.state.sensor, w: v, id: 'custom' }), {
    min: 4, max: 100, step: 0.1, width: 64,
  });
  ctl.sensorH = num(s.sensor.h, (v) => viewer.applySensor({ ...viewer.state.sensor, h: v, id: 'custom' }), {
    min: 3, max: 100, step: 0.1, width: 64,
  });
  optics.body.append(
    row('Размер сенсора, мм', h('div', { class: 'row', style: 'gap:5px;flex:0' }, ctl.sensorW.el, h('span', { text: '×', style: 'color:var(--txt-faint)' }), ctl.sensorH.el))
  );

  ctl.basis = seg(
    [
      { value: 'vertical', label: 'По высоте', title: 'fov в three.js — вертикальный' },
      { value: 'horizontal', label: 'По ширине', title: 'Кадр режется по ширине' },
    ],
    s.basis,
    (v) => viewer.setBasis(v)
  );
  optics.body.append(row('База FOV', ctl.basis.el));

  ctl.wheel = seg(
    [
      { value: 'focal', label: 'Фокусное', title: 'Колесо меняет фокусное расстояние' },
      { value: 'dolly', label: 'Наезд', title: 'Колесо двигает камеру' },
    ],
    s.wheelMode,
    (v) => viewer.setWheelMode(v)
  );
  optics.body.append(row('Колесо мыши', ctl.wheel.el));

  optics.body.append(
    h('p', {
      class: 'hint',
      html: 'Связь: <b>f = d / (2·tan(FOV/2))</b>. Для full frame (36×24 мм) FOV считается по <b>высоте</b> — так 50 мм дают привычные 27°.',
    })
  );

  /* Вид */
  const view = section('Вид и отображение');
  const views = [
    ['iso', 'Изометрия'], ['front', 'Фронт'], ['back', 'Зад'],
    ['left', 'Слева'], ['right', 'Справа'], ['top', 'Сверху'],
  ];
  const viewChips = chipRow(views.map((v) => v[1]), (label) => {
    const found = views.find((v) => v[1] === label);
    if (found) viewer.setView(found[0]);
  });
  viewChips.setActive('Изометрия');
  view.body.append(h('div', { class: 'row row--wrap' }, viewChips.el));

  view.body.append(
    h('div', { class: 'row', style: 'gap:6px' },
      h('button', { class: 'btn', type: 'button', text: 'Вписать (F)', style: 'flex:1', onclick: () => viewer.fit() }),
      h('button', { class: 'btn', type: 'button', text: 'Сброс (R)', style: 'flex:1', onclick: () => viewer.reset() })
    )
  );

  ctl.autorotate = switchRow('Автовращение', s.autoRotate, (v) => viewer.setAutoRotate(v));
  ctl.shift = switchRow('Центрировать по видимой области', s.shiftToView, (v) =>
    viewer.setFraming({ shiftToView: v })
  );
  ctl.dims = switchRow('Габариты и размеры', s.dims, (v) => viewer.setDimsVisible(v));
  ctl.grid = switchRow('Сетка', s.grid, (v) => viewer.setGrid(v));
  ctl.axes = switchRow('Оси', s.axes, (v) => viewer.setAxes(v));
  ctl.ground = switchRow('Пол и тень', s.ground, (v) => viewer.setGround(v));
  ctl.wire = switchRow('Каркас (wireframe)', s.wireframe, (v) => viewer.setWireframe(v));
  ctl.clay = switchRow('Глина (материал)', s.clay, (v) => viewer.setClay(v));
  ctl.edges = switchRow('Рёбра', s.edges, (v) => viewer.setEdges(v));
  view.body.append(
    ctl.autorotate.el, ctl.shift.el, ctl.dims.el, ctl.grid.el, ctl.axes.el, ctl.ground.el,
    ctl.wire.el, ctl.clay.el, ctl.edges.el
  );

  /* Рендер */
  const render = section('Рендер и единицы');
  ctl.bg = seg(
    [
      { value: 'gradient', label: 'Градиент' },
      { value: 'dark', label: 'Тёмный' },
      { value: 'light', label: 'Светлый' },
      { value: 'transparent', label: 'Прозрачный' },
    ],
    s.background,
    (v) => viewer.setBackground(v)
  );
  render.body.append(row('Фон', ctl.bg.el));

  const tmSelect = h('select', { class: 'num', style: 'width:130px' },
    [
      ['aces', 'ACES (кино)'],
      ['agx', 'AgX'],
      ['neutral', 'Neutral'],
      ['reinhard', 'Reinhard'],
      ['linear', 'Без тонмаппинга'],
    ].map(([v, l]) => h('option', { value: v, ...(v === s.toneMapping ? { selected: 'selected' } : {}) }, l))
  );
  tmSelect.addEventListener('change', () => viewer.setToneMapping(tmSelect.value));
  render.body.append(row('Тонмаппинг', tmSelect));

  ctl.exposure = slider({
    min: 0.1, max: 3, step: 0.01, value: s.exposure,
    format: (v) => `×${Number(v).toFixed(2)}`,
    onInput: (v) => viewer.setExposure(v),
  });
  render.body.append(row('Экспозиция', ctl.exposure.el));

  ctl.env = slider({
    min: 0, max: 3, step: 0.01, value: s.envIntensity,
    format: (v) => Number(v).toFixed(2),
    onInput: (v) => viewer.setEnvIntensity(v),
  });
  render.body.append(row('Свет окружения', ctl.env.el));

  ctl.units = seg(
    [
      { value: 'auto', label: 'Авто' },
      { value: 'm', label: 'м' },
      { value: 'cm', label: 'см' },
      { value: 'mm', label: 'мм' },
      { value: 'in', label: '″' },
    ],
    'auto',
    (v) => viewer.setUnit(v)
  );
  render.body.append(row('Единицы', ctl.units.el), h('div', { style: 'height:10px' }));

  const transparentShot = h('input', { type: 'checkbox' });
  render.body.append(
    h('button', {
      class: 'btn', type: 'button', text: 'Сохранить PNG (S)', style: 'width:100%',
      onclick: () => actions.screenshot(transparentShot.checked),
    }),
    h('label', { class: 'row', style: 'margin-top:9px;cursor:pointer' },
      transparentShot, h('span', { class: 'row__label', text: 'Снимок с прозрачным фоном' })
    )
  );

  root.append(model.el, optics.el, view.el, render.el);

  /* ──────────── синхронизация UI ← viewer ──────────── */
  function sync(state) {
    ctl.projection.set(state.projection);
    ctl.basis.set(state.basis);
    ctl.wheel.set(state.wheelMode);
    ctl.autorotate.set(state.autoRotate);
    ctl.shift.set(state.shiftToView);
    ctl.dims.set(state.dims);
    ctl.grid.set(state.grid);
    ctl.axes.set(state.axes);
    ctl.ground.set(state.ground);
    ctl.wire.set(state.wireframe);
    ctl.clay.set(state.clay);
    ctl.edges.set(state.edges);
    ctl.bg.set(state.background);
    ctl.exposure.set(state.exposure);
    ctl.env.set(state.envIntensity);
    sensorSelect.value = state.sensor.id;
    ctl.sensorW.set(state.sensor.w);
    ctl.sensorH.set(state.sensor.h);

    const isPersp = state.projection === 'perspective';
    for (const el of [ctl.focal.el, ctl.fov.el, ctl.focalSlider.input, ctl.fovSlider.input]) el.disabled = !isPersp;
  }

  function syncOptics({ focal, fov }) {
    ctl.focal.set(focal);
    ctl.focalSlider.set(focalToSlider(focal));
    ctl.fov.set(fov);
    ctl.fovSlider.set(fov);
  }

  function updateModelInfo(stats) {
    if (!stats) {
      info.set([['Состояние', 'файл не загружен']]);
      modelNote.hidden = false;
      modelNote.textContent =
        'Перетащите файл в окно или нажмите «Открыть файл». Ничего не загружается на сервер — вся геометрия считается в браузере.';
      return;
    }
    const u = viewer.unit === 'auto' ? stats.unit : viewer.unit;
    const k = viewer.unit === 'auto' ? stats.unitFactor : { m: 1, cm: 0.1, mm: 1, in: 39.3701 }[viewer.unit];
    const dim = (v) => (v * k >= 100 ? Math.round(v * k) : Math.round(v * k * 100) / 100);
    info.set([
      ['Файл', stats.name],
      ['Формат', stats.format],
      ['Размер файла', fmtBytes(stats.size)],
      ['Меши', String(stats.meshes)],
      ['Треугольники', stats.triangles.toLocaleString('ru-RU')],
      ['Вершины', stats.vertices.toLocaleString('ru-RU')],
      ['Материалы', String(stats.materials)],
      ['Текстуры', stats.textures ? String(stats.textures) : 'нет'],
      ['Габариты Ш×В×Г', `${dim(stats.box.size.x)} × ${dim(stats.box.size.y)} × ${dim(stats.box.size.z)} ${u}`],
    ]);
    modelNote.hidden = !stats.unitGuessed;
    modelNote.textContent = `Единицы «${stats.unit}» угаданы по габаритам — переопределите в разделе «Рендер и единицы».`;
  }

  viewer.on('change', sync);
  viewer.on('optics', syncOptics);
  sync(viewer.state);
  syncOptics({ focal: viewer.getFocal(), fov: viewer.getFov() });
  updateModelInfo(null); // сразу показываем нормальное пустое состояние, а не заглушку

  return { sync, syncOptics, updateModelInfo, setViewChip: (label) => viewChips.setActive(label) };
}

function fmtBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export { fmtBytes };
