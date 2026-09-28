import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export const SUPPORTED_EXT = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply'];

/** Модельные файлы, которые можно принять, если пользователь кинул «что-то не то». */
export function isModelFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return SUPPORTED_EXT.includes(ext);
}

function extOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

/** Грубая, но честная попытка угадать реальный масштаб модели. */
export function guessUnit(maxDim) {
  if (maxDim > 500) return { unit: 'mm', factor: 1, guess: true };
  if (maxDim > 50) return { unit: 'cm', factor: 0.1, guess: true };
  if (maxDim < 0.5) return { unit: 'mm', factor: 1, guess: true };
  return { unit: 'm', factor: 1, guess: true };
}

export class ModelLoader {
  constructor(renderer) {
    this.renderer = renderer;
    this.objectURLs = new Set();

    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier((url) => {
      // glTF/OBJ могут тянуть текстуры и .bin по соседним именам — отдаём blob из списка файлов
      const file = this.#files?.get(decodeURIComponent(url.split('/').pop() || url));
      return file ? this.#url(file) : url;
    });

    // Пути декодеров не задаём: three сам резолвит их через import.meta.url,
    // и Vite кладёт их в assets/ — так они попадают в precache без дублей в public/
    this.draco = new DRACOLoader(this.manager);
    this.ktx2 = new KTX2Loader(this.manager).detectSupport(renderer);

    this.gltf = new GLTFLoader(this.manager).setDRACOLoader(this.draco).setKTX2Loader(this.ktx2);
    this.obj = new OBJLoader(this.manager);
    this.mtl = new MTLLoader(this.manager);
    this.stl = new STLLoader(this.manager);
    this.ply = new PLYLoader(this.manager);
    this.fbx = new FBXLoader(this.manager);
  }

  #files = new Map();
  #url(file) {
    if (!this.#urls.has(file)) {
      const u = URL.createObjectURL(file);
      this.#urls.set(file, u);
      this.objectURLs.add(u);
    }
    return this.#urls.get(file);
  }
  #urls = new Map();

  /**
   * @param {File} file главный (модельный) файл
   * @param {File[]} siblings остальные файлы из того же drag-n-drop (текстуры, .mtl, .bin)
   * @param {(info:{loaded:number,total:number,label:string})=>void} onProgress
   */
  async load(file, siblings = [], onProgress = () => {}) {
    this.#files = new Map();
    for (const f of [...siblings, file]) this.#files.set(f.name, f);
    for (const f of [...siblings, file]) this.#files.set(extOf(f.name), f);

    this.manager.onProgress = (url, loaded, total) => {
      onProgress({
        loaded,
        total: total || 0,
        label: `Загрузка ресурсов · ${decodeURIComponent(url.split('/').pop() || url)}`,
      });
    };
    onProgress({ loaded: 0, total: 0, label: `Читаю ${file.name}` });

    const ext = extOf(file.name);
    const url = this.#url(file);
    let object;
    let animations = [];
    let sourceFormat = ext;

    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await this.gltf.loadAsync(url);
      object = gltf.scene || gltf.scenes[0];
      animations = gltf.animations || [];
    } else if (ext === 'obj') {
      const mtlFile = siblings.find((f) => extOf(f.name) === 'mtl') || this.#files.get('mtl');
      if (mtlFile) {
        try {
          // loadAsync у MTLLoader отдаёт MaterialCreator; OBJLoader берёт его через setMaterials
          const materials = await this.mtl.loadAsync(this.#url(mtlFile));
          materials.preload();
          this.obj.setMaterials(materials);
          object = await this.obj.loadAsync(url);
        } catch (e) {
          console.warn('MTL не разобрался, беру OBJ без материалов:', e);
          object = await this.obj.loadAsync(url);
        }
      } else {
        object = await this.obj.loadAsync(url);
      }
    } else if (ext === 'stl') {
      object = wrap(new THREE.Mesh(await this.stl.loadAsync(url), defaultMaterial()));
      sourceFormat = 'stl';
    } else if (ext === 'ply') {
      object = wrap(new THREE.Mesh(await this.ply.loadAsync(url), defaultMaterial()));
    } else if (ext === 'fbx') {
      object = await this.fbx.loadAsync(url);
    } else {
      throw new Error(`Формат .${ext} не поддерживается`);
    }

    if (!object) throw new Error('В файле не найдено ни одной 3D-сцены');
    if (!object.isObject3D) throw new Error('Не удалось разобрать сцену');

    object.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = true;
      }
    });

    return { object, animations, stats: collectStats(object, file, sourceFormat), file };
  }

  dispose() {
    for (const u of this.objectURLs) URL.revokeObjectURL(u);
    this.objectURLs.clear();
    this.#urls.clear();
    this.#files.clear();
  }
}

function wrap(mesh) {
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function defaultMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xb9bec9, roughness: 0.55, metalness: 0.15 });
}

/** Собираем статистику для строки состояния и карточки «Модель». */
export function collectStats(object, file, sourceFormat) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  let textured = 0;
  const materials = new Set();

  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    if (pos) {
      vertices += pos.count;
      triangles += g.index ? g.index.count / 3 : pos.count / 3;
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      materials.add(m.uuid);
      if (m.map || m.normalMap || m.roughnessMap || m.metalnessMap || m.emissiveMap) textured++;
    }
  });

  const maxDim = Math.max(size.x, size.y, size.z);
  const { unit, factor, guess } = guessUnit(maxDim || 1);

  return {
    name: file?.name || 'Модель',
    size: file?.size || 0,
    format: (sourceFormat || '').toUpperCase(),
    meshes,
    triangles: Math.round(triangles),
    vertices,
    materials: materials.size,
    textures: textured,
    box: { size, center, min: box.min.clone(), max: box.max.clone() },
    dims: { x: size.x * factor, y: size.y * factor, z: size.z * factor },
    unit,
    unitFactor: factor,
    unitGuessed: guess,
  };
}
