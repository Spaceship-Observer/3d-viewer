import * as THREE from 'three';

/** Демо-фигуры, чтобы приложение было чем наполнить до загрузки своего файла. */
export const DEMO_SHAPES = [
  { id: 'cube', label: 'Куб' },
  { id: 'sphere', label: 'Сфера' },
  { id: 'cylinder', label: 'Цилиндр' },
  { id: 'torus', label: 'Тор' },
  { id: 'knot', label: 'Плетение' },
  { id: 'vase', label: 'Ваза' },
  { id: 'gear', label: 'Шестерня' },
];

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.25, ...opts });

export function buildDemoShape(id) {
  const group = new THREE.Group();
  let mesh;

  switch (id) {
    case 'cube':
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6, 2, 2, 2), mat(0x4c8dff));
      break;
    case 'sphere':
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat(0x8b5cf6, { flatShading: true }));
      break;
    case 'cylinder':
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 2, 64, 1), mat(0x22c3a6));
      break;
    case 'torus':
      mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.85, 0.26, 180, 24, 2, 3), mat(0xf472b6));
      break;
    case 'knot':
      mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.3, 256, 32, 3, 7), mat(0xf59e0b));
      break;
    case 'vase': {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const r = 0.35 + Math.sin(t * Math.PI * 1.15) * 0.5 * (1 - t * 0.35) + (1 - t) * 0.18;
        pts.push(new THREE.Vector2(Math.max(0.08, r), t * 2.2 - 1.1));
      }
      mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), mat(0x38bdf8, { side: THREE.DoubleSide }));
      break;
    }
    case 'gear':
      mesh = buildGear();
      break;
    default:
      mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(0.9, 0.3, 200, 32), mat(0x4c8dff));
  }

  mesh.name = `demo:${id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function buildGear() {
  const teeth = 18;
  const shape = new THREE.Shape();
  const rOuter = 1.0;
  const rRoot = 0.82;
  const rHole = 0.3;
  const step = (Math.PI * 2) / teeth;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const pts = [
      [rRoot, a0 + step * 0.08],
      [rOuter, a0 + step * 0.26],
      [rOuter, a0 + step * 0.56],
      [rRoot, a0 + step * 0.74],
      [rRoot, a0 + step * 0.96],
    ];
    for (const [r, a] of pts) {
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0 && a === a0 + step * 0.08) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, rHole, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.34,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 2,
    curveSegments: 32,
  });
  geo.center();
  return new THREE.Mesh(geo, mat(0xfbbf24, { metalness: 0.6, roughness: 0.3 }));
}
