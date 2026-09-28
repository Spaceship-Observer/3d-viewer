import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  SENSORS,
  FOCAL_MIN,
  FOCAL_MAX,
  FOV_MIN,
  FOV_MAX,
  focalFromFov,
  fovFromFocal,
  clampFocal,
  clampFov,
} from './optics.js';

const TONE_MAPPINGS = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  linear: THREE.LinearToneMapping,
};

const VIEWS = {
  iso: [1, 0.85, 1],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0.02, 1, 0.09],
};

const UNIT_FACTORS = { auto: null, m: 1, cm: 0.1, mm: 1, in: 39.3701 };

export class Viewer {
  constructor({ canvas, labels, stage }) {
    this.canvas = canvas;
    this.labelsEl = labels;
    this.stage = stage || canvas.parentElement;

    this.listeners = new Map();
    this.stats = null;
    this.unit = 'auto';
    this.panelWidthPx = 0; // ширина перекрывающей панели для линзового сдвига

    this.state = {
      projection: 'perspective',
      wheelMode: 'focal',
      wireframe: false,
      clay: false,
      edges: false,
      grid: true,
      axes: false,
      dims: true,
      ground: true,
      shadows: true,
      autoRotate: false,
      background: 'gradient',
      toneMapping: 'aces',
      exposure: 1,
      envIntensity: 1,
      sensor: { ...SENSORS[0] },
      basis: 'vertical',
      focal: 50,
      shiftToView: true,
    };

    this.#initRenderer();
    this.#initScene();
    this.#initCameras();
    this.#initHelpers();
    this.#initOverlay();
    this.#initEvents();

    this.applySensor(this.state.sensor);
    this.setFocal(50, { silent: true });
    this.#loop();
  }

  /* ───────────────────────── события ───────────────────────── */
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }
  emit(name, payload) {
    this.listeners.get(name)?.forEach((fn) => fn(payload));
  }

  /* ───────────────────────── инициализация ───────────────────────── */
  #initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = TONE_MAPPINGS.aces;
    this.renderer.toneMappingExposure = 1;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.emit('error', 'Контекст WebGL потерян — перезагрузите вкладку');
    });
  }

  #initScene() {
    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.035);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 1;
    pmrem.dispose();

    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.position.set(4, 7, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1536, 1536);
    this.key.shadow.bias = -0.0012;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 2;
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.DirectionalLight(0x9db8ff, 0.55);
    this.fill.position.set(-5, 2.5, -4);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffffff, 0.9);
    this.rim.position.set(-3, 2, -6);
    this.scene.add(this.rim);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    this.setBackground(this.state.background);
  }

  #initCameras() {
    const aspect = this.#aspect();
    this.persp = new THREE.PerspectiveCamera(30, aspect, 0.01, 5000);
    this.persp.position.set(3.2, 2.2, 4.2);

    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.ortho.position.copy(this.persp.position);
    this.ortho.zoom = 1;
    this._orthoFrameHeight = 4;

    this.camera = this.persp;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.95;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.01;
    this.controls.maxDistance = 3000;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  #initHelpers() {
    this.grid = new THREE.GridHelper(10, 20, 0x4a5570, 0x232838);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.65;
    this.grid.material.depthWrite = false;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1.6);
    this.axes.visible = false;
    this.scene.add(this.axes);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.32, transparent: true })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0x4c8dff);
    this.boxHelper.visible = false;
    this.boxHelper.material.transparent = true;
    this.boxHelper.material.opacity = 0.55;
    this.scene.add(this.boxHelper);

    this._edgeLines = [];

    this.clayMaterial = new THREE.MeshStandardMaterial({
      color: 0xc3c8d4,
      roughness: 0.78,
      metalness: 0.04,
    });
  }

  #initOverlay() {
    this.dimLabels = {};
    for (const axis of ['x', 'y', 'z']) {
      const el = document.createElement('div');
      el.className = 'dim-label';
      el.dataset.axis = axis;
      el.style.display = 'none';
      this.labelsEl.appendChild(el);
      this.dimLabels[axis] = el;
    }
  }

  #initEvents() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.resize();

    // Колесо: режим «фокусное» перехватываем на родителе (capture), иначе OrbitControls
    // успевает обработать событие раньше нас — он слушает сам canvas.
    this.stage.addEventListener(
      'wheel',
      (e) => {
        if (e.target !== this.canvas) return;
        if (e.ctrlKey) return; // Ctrl+колесо — всегда наезд
        if (this.state.wheelMode !== 'focal' || this.state.projection !== 'perspective') return;
        e.preventDefault();
        e.stopPropagation();
        const factor = Math.pow(1.003, e.deltaY);
        this.setFov(this.persp.fov * factor);
      },
      { passive: false, capture: true }
    );
  }

  /* ───────────────────────── модель ───────────────────────── */
  setModel(object, stats) {
    this.clearModel();
    this.modelRoot.add(object);
    this.stats = stats;
    this.#applyStatsToScene(stats);
    this.rebuildEdges();
    this.setDimsVisible(this.state.dims);
    this.fit();
    this.emit('model', stats);
    this.emit('change', this.state);
  }

  clearModel() {
    this.#removeEdges();
    if (this.modelRoot.children.length) {
      const old = [...this.modelRoot.children];
      for (const child of old) {
        this.modelRoot.remove(child);
        child.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            o.geometry?.dispose?.();
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (!m) continue;
              for (const key of Object.keys(m)) {
                const v = m[key];
                if (v && v.isTexture) v.dispose();
              }
              m.dispose?.();
            }
          }
        });
      }
    }
    this.#removeEdges();
    this.stats = null;
    this.boxHelper.visible = false;
    this.#hideDimLabels();
    this.#updateLabels(null);
  }

  #removeEdges() {
    for (const { lines, geo, mat } of this._edgeLines) {
      lines.removeFromParent();
      geo.dispose();
      mat.dispose();
    }
    this._edgeLines = [];
  }

  #applyStatsToScene(stats) {
    const { box } = stats;
    const maxDim = Math.max(box.size.x, box.size.y, box.size.z) || 1;

    // Рамка габаритов: без явного копирования бокса в неё попадает пустой Box3 (NaN)
    this.boxHelper.box.min.copy(box.min);
    this.boxHelper.box.max.copy(box.max);
    this.boxHelper.visible = this.state.dims;

    // Сетка, пол и тень подгоняем под размер модели
    const gridSize = niceNumber(maxDim * 2.2);
    this.grid.scale.setScalar(gridSize / 10);
    this.ground.scale.setScalar(gridSize / 40);
    this.ground.position.y = this.state.ground ? box.min.y : -1e5;
    this.axes.scale.setScalar(niceNumber(maxDim) / 1.6);
    this.axes.position.set(box.min.x, box.min.y, box.min.z);

    this.#applyShadowFrustum(box, maxDim);

    this.persp.near = Math.max(maxDim / 5000, 0.0005);
    this.persp.far = maxDim * 200;
    this.ortho.near = -maxDim * 100;
    this.ortho.far = maxDim * 300;
    this.#applyProjection();
  }

  #applyShadowFrustum(box, maxDim) {
    const d = maxDim * 2.6;
    const cam = this.key.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 0.01;
    cam.far = d * 6;
    cam.updateProjectionMatrix();
    this.key.position.set(box.center.x + d * 1.2, box.center.y + d * 1.8, box.center.z + d * 1.1);
    this.key.target.position.copy(box.center);
    this.key.target.updateMatrixWorld();
  }

  /* ───────────────────────── камера / оптика ───────────────────────── */
  #aspect() {
    const r = this.canvas.getBoundingClientRect();
    return Math.max(0.0001, r.width / Math.max(1, r.height));
  }

  getFocal() {
    return this.state.focal;
  }
  getFov() {
    return this.persp.fov;
  }
  getProjection() {
    return this.state.projection;
  }

  /** Ставит фокусное и пересчитывает FOV. */
  setFocal(mm, { silent = false } = {}) {
    this.state.focal = clampFocal(mm);
    const fov = clampFov(fovFromFocal(this.state.focal, this.state.sensor, this.state.basis));
    this.persp.fov = fov;
    this.#applyProjection();
    if (!silent) this.emit('change', this.state);
    this.emit('optics', { focal: this.state.focal, fov });
  }

  /** Ставит угол поля зрения и пересчитывает фокусное. */
  setFov(deg, { silent = false } = {}) {
    const fov = clampFov(deg);
    this.persp.fov = fov;
    this.#applyProjection();
    this.state.focal = clampFocal(focalFromFov(fov, this.state.sensor, this.state.basis));
    if (!silent) this.emit('change', this.state);
    this.emit('optics', { focal: this.state.focal, fov });
  }

  /** Смена сенсора держит фокусное (как смена носителя при том же объективе). */
  applySensor(sensor) {
    const keepFocal = this.state.focal;
    this.state.sensor = { ...sensor };
    this.setFocal(keepFocal, { silent: true });
    this.emit('change', this.state);
    this.emit('optics', { focal: this.state.focal, fov: this.getFov() });
  }

  /** Смена базы держит картинку (FOV), меняется только подпись в мм. */
  setBasis(basis) {
    this.state.basis = basis;
    this.setFov(this.persp.fov, { silent: true });
    this.emit('change', this.state);
  }

  stepFocal(deltaMm) {
    this.setFocal(this.state.focal + deltaMm);
  }

  setProjection(kind) {
    if (kind === this.state.projection) return;
    const from = this.camera;
    this.state.projection = kind;
    const to = kind === 'ortho' ? this.ortho : this.persp;

    to.position.copy(from.position);
    to.quaternion.copy(from.quaternion);
    to.up.copy(this.controls ? from.up : new THREE.Vector3(0, 1, 0));
    this.camera = to;

    // Пересоздаём контроллер: OrbitControls привязан к конкретной камере
    this.controls.dispose();
    this.controls = new OrbitControls(to, this.canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.075,
      rotateSpeed: 0.95,
      zoomSpeed: 0.9,
      panSpeed: 0.8,
      screenSpacePanning: true,
      minDistance: 0.01,
      maxDistance: 3000,
    });
    this.controls.autoRotateSpeed = 0.9;
    this.controls.target.copy(this.target ?? new THREE.Vector3());
    this.controls.update();
    this.#syncOrthoFromPerspective();
    this.resize();
    this.emit('change', this.state);
  }

  /**
   * Линзовый сдвиг: панель настроек перекрывает правую часть канваса, поэтому
   * кадр смещается влево — модель остаётся по центру ВИДИМОЙ области.
   * Перспективные искажения при этом не меняются (в отличие от сдвига камеры).
   */
  setFraming({ shiftToView = this.state.shiftToView, panelWidthPx = this.panelWidthPx || 0 } = {}) {
    this.state.shiftToView = shiftToView;
    this.panelWidthPx = panelWidthPx;
    this.#applyProjection();
  }

  getLensShiftNdc() {
    if (!this.state.shiftToView || this.state.projection !== 'perspective') return 0;
    const w = this._rectW || 1;
    const panel = Number.isFinite(this.panelWidthPx) ? this.panelWidthPx : 0;
    // Плюс: положительный filmOffset двигает кадр вправо, а значит объект — влево, из-под панели
    return Math.min(0.45, panel / (2 * w));
  }

  #applyProjection() {
    const aspect = this.#aspect();
    if (this.state.projection === 'perspective') {
      const f = this.getLensShiftNdc();
      // three: left += near * filmOffset / filmWidth  →  подбираем filmOffset под нужный сдвиг
      this.persp.filmOffset = f * 2 * this.persp.getFilmWidth() * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) * aspect;
      this.persp.updateProjectionMatrix();
    } else {
      this.#updateOrthoFrustum();
    }
  }

  #syncOrthoFromPerspective() {
    const dist = Math.max(1e-4, this.camera.position.distanceTo(this.controls.target));
    this._orthoFrameHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * dist;
    this.ortho.zoom = 1;
    this.#updateOrthoFrustum();
  }

  #updateOrthoFrustum() {
    const aspect = this.#aspect();
    const h = this._orthoFrameHeight / 2;
    const w = h * aspect;
    // В ортокамере сдвигаем сам объём, filmOffset там не поддерживается
    const panel = Number.isFinite(this.panelWidthPx) ? this.panelWidthPx : 0;
    const shift = this.state.shiftToView ? (panel / (this._rectW || 1)) * w : 0;
    this.ortho.left = -w + shift;
    this.ortho.right = w + shift;
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.updateProjectionMatrix();
  }

  setView(preset) {
    const dir = VIEWS[preset];
    if (!dir || !this.stats) return;
    const box = this.stats.box;
    this.target = box.center.clone();
    this.controls.target.copy(this.target);

    const v = new THREE.Vector3(...dir).normalize();
    const radius = box.size.length() / 2 || 1;
    const aspect = this.#aspect();
    const vFov = THREE.MathUtils.degToRad(this.persp.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12;

    this.camera.position.copy(this.target).addScaledVector(v, dist);
    this.camera.lookAt(this.target);
    this.controls.update();
    this.#syncOrthoFromPerspective();
  }

  /** Вписать модель в кадр, сохранив направление взгляда. */
  fit(padding = 1.12) {
    if (!this.stats) return;
    const box = this.stats.box;
    this.target = box.center.clone();
    this.controls.target.copy(this.target);

    const radius = box.size.length() / 2 || 1;
    const aspect = this.#aspect();
    const vFov = THREE.MathUtils.degToRad(this.persp.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * padding;

    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.85, 1);
    dir.normalize();
    this.camera.position.copy(this.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.target);
    this.controls.update();
    this.#syncOrthoFromPerspective();
  }

  reset() {
    this.setProjection('perspective');
    this.state.wheelMode = 'focal';
    this.setFocal(50);
    this.setView('iso');
  }

  setAutoRotate(on) {
    this.state.autoRotate = on;
    this.controls.autoRotate = on;
    this.emit('change', this.state);
  }

  /* ───────────────────────── отображение ───────────────────────── */
  setWireframe(on) {
    this.state.wireframe = on;
    this.modelRoot.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (on) {
          if (m.userData.__wf === undefined) m.userData.__wf = !!m.wireframe;
          m.wireframe = true;
        } else {
          m.wireframe = m.userData.__wf ?? false;
        }
      }
    });
    this.emit('change', this.state);
  }

  setClay(on) {
    this.state.clay = on;
    this.modelRoot.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (!o.userData.__mat) o.userData.__mat = o.material;
        o.material = this.clayMaterial;
      } else if (o.userData.__mat) {
        o.material = o.userData.__mat;
        o.userData.__mat = null;
      }
    });
    this.emit('change', this.state);
  }

  setEdges(on) {
    this.state.edges = on;
    this.rebuildEdges();
    this.emit('change', this.state);
  }

  rebuildEdges() {
    // Снимаем прошлый слой рёбер — они висят детьми мешей, а не в общей группе
    this.#removeEdges();

    if (!this.state.edges || !this.stats) return;
    if (this.stats.triangles > 1_200_000) {
      this.emit('notice', 'Рёбра отключены: модель слишком тяжёлая (>1.2 млн треугольников)');
      this.state.edges = false;
      return;
    }
    this.modelRoot.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = new THREE.EdgesGeometry(o.geometry, 24);
      if (!geo.getAttribute('position')) {
        geo.dispose();
        return;
      }
      const mat = new THREE.LineBasicMaterial({ color: 0x0d0f14, transparent: true, opacity: 0.8 });
      const lines = new THREE.LineSegments(geo, mat);
      lines.renderOrder = 2;
      lines.raycast = () => {};
      o.add(lines);
      this._edgeLines.push({ lines, geo, mat });
    });
  }

  setGrid(on) {
    this.state.grid = on;
    this.grid.visible = on;
    this.emit('change', this.state);
  }
  setAxes(on) {
    this.state.axes = on;
    this.axes.visible = on;
    this.emit('change', this.state);
  }
  setDimsVisible(on) {
    this.state.dims = on;
    this.boxHelper.visible = on && !!this.stats;
    if (!on) this.#hideDimLabels();
    this.emit('change', this.state);
  }

  #hideDimLabels() {
    for (const el of Object.values(this.dimLabels)) el.style.display = 'none';
  }
  setShadows(on) {
    this.state.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.ground.visible = on && this.state.ground;
    this.scene.traverse((o) => {
      if (o.isMesh) o.receiveShadow = on;
    });
    this.emit('change', this.state);
  }
  setGround(on) {
    this.state.ground = on;
    this.ground.visible = on && this.state.shadows;
    if (this.stats) this.ground.position.y = on ? this.stats.box.min.y : -1e5;
    this.emit('change', this.state);
  }

  setBackground(mode) {
    this.state.background = mode;
    this.canvas.classList.toggle('is-transparent', mode === 'transparent');
    if (mode === 'gradient' || mode === 'transparent') this.scene.background = null;
    else this.scene.background = new THREE.Color(mode === 'light' ? 0xe8ebf2 : 0x0b0c10);
    this.emit('change', this.state);
  }

  setExposure(v) {
    this.state.exposure = v;
    this.renderer.toneMappingExposure = v;
    this.emit('change', this.state);
  }

  setToneMapping(mode) {
    this.state.toneMapping = mode;
    this.renderer.toneMapping = TONE_MAPPINGS[mode] ?? TONE_MAPPINGS.aces;
    this.emit('change', this.state);
  }

  setEnvIntensity(v) {
    this.state.envIntensity = v;
    this.scene.environmentIntensity = v;
    this.emit('change', this.state);
  }

  setWheelMode(mode) {
    this.state.wheelMode = mode;
    this.canvas.style.cursor = mode === 'focal' ? 'ns-resize' : 'grab';
    this.emit('change', this.state);
  }

  setUnit(unit) {
    this.unit = unit;
    this.#updateLabels(this.stats);
    this.emit('change', this.state);
  }

  #unitFactor() {
    if (this.unit !== 'auto' && UNIT_FACTORS[this.unit] != null) return UNIT_FACTORS[this.unit];
    return this.stats?.unitFactor ?? 1;
  }
  #unitLabel() {
    if (this.unit !== 'auto') return this.unit;
    return this.stats?.unit ?? 'm';
  }

  /* ───────────────────────── цикл кадра ───────────────────────── */
  resize() {
    // Важно мерить по самому канвасу: он спозиционирован inset'ом (топбар/статусбар),
    // и его бокс меньше родителя — иначе картинка уезжает по вертикали, а подписи целятся мимо.
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 1);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 1);
    this.renderer.setSize(w, h, false);
    this._rectW = w;
    this._rectH = h;
    this.persp.aspect = w / h;
    this.#applyProjection();
  }

  #loop() {
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      if (this.state.background === 'gradient') this.#gradientBackdrop();
      this.renderer.render(this.scene, this.camera);
      this.#updateLabels(this.stats);
      this.#fps();
    });
  }

  #gradientBackdrop() {
    // Мягкий вертикальный градиент рисуем полноэкранным мешем перед камерой
    if (!this._gradBg) {
      const geo = new THREE.PlaneGeometry(2, 2);
      const mat = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x1a1e2a) },
          bottom: { value: new THREE.Color(0x08090c) },
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999999, 1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 bottom; varying vec2 vUv; void main(){ gl_FragColor = vec4(mix(bottom, top, pow(vUv.y, 1.25)), 1.0); }',
      });
      this._gradBg = new THREE.Mesh(geo, mat);
      this._gradBg.frustumCulled = false;
      this._gradBg.renderOrder = -1;
      this.scene.add(this._gradBg);
    }
    this._gradBg.visible = this.scene.background === null && this.state.background === 'gradient';
  }

  #updateLabels(stats) {
    if (!stats || !this.state.dims) return;
    const { min, max, size } = stats.box;
    const k = this.#unitFactor();
    const u = this.#unitLabel();
    const mid = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    const pts = {
      x: [mid.x, min.y, max.z],
      y: [min.x, mid.y, max.z],
      z: [max.x, min.y, mid.z],
    };
    const text = {
      x: `${fmtLen(size.x * k)} ${u}`,
      y: `${fmtLen(size.y * k)} ${u}`,
      z: `${fmtLen(size.z * k)} ${u}`,
    };

    const rectW = this._rectW || this.canvas.clientWidth;
    const rectH = this._rectH || this.canvas.clientHeight;
    const v = new THREE.Vector3();
    for (const axis of ['x', 'y', 'z']) {
      const el = this.dimLabels[axis];
      v.set(...pts[axis]).project(this.camera);
      if (v.z > 1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${((v.x + 1) / 2) * rectW}px`;
      el.style.top = `${((1 - v.y) / 2) * rectH}px`;
      el.textContent = text[axis];
    }
  }

  #fps() {
    this._frames = (this._frames || 0) + 1;
    const now = performance.now();
    if (!this._fpsAt) this._fpsAt = now;
    if (now - this._fpsAt >= 500) {
      const fps = Math.round((this._frames * 1000) / (now - this._fpsAt));
      this.emit('fps', {
        fps,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      });
      this._frames = 0;
      this._fpsAt = now;
    }
  }

  /* ───────────────────────── снимок ───────────────────────── */
  screenshot({ transparent = false } = {}) {
    const prevBg = this.scene.background;
    const prevAlpha = this.renderer.getClearAlpha();
    const prevGrad = this._gradBg?.visible;

    if (transparent) {
      this.scene.background = null;
      this.renderer.setClearAlpha(0);
      if (this._gradBg) this._gradBg.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
    let url;
    try {
      url = this.canvas.toDataURL('image/png');
    } finally {
      this.scene.background = prevBg;
      this.renderer.setClearAlpha(prevAlpha);
      if (this._gradBg) this._gradBg.visible = prevGrad;
    }
    return url;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.envRT?.dispose();
    this.renderer.dispose();
  }
}

function niceNumber(x) {
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const n = x / base;
  const snapped = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return snapped * base;
}

function fmtLen(v) {
  if (v >= 1000) return Math.round(v).toLocaleString('ru-RU');
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 1000) / 1000);
}

export { SENSORS, FOCAL_MIN, FOCAL_MAX, FOV_MIN, FOV_MAX };
