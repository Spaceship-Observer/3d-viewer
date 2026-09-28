/**
 * Оптика камеры: связь «фокусное расстояние (мм) ↔ угол поля зрения».
 *
 * three.js задаёт fov по ВЕРТИКАЛИ, поэтому база по умолчанию — вертикальная
 * (у полнокадровой матрицы это 24 мм, что и даёт привычные 50 мм на FF).
 * База по горизонтали удобна в архитектурной визуализации, где кадр «режут» по ширине.
 */

export const SENSORS = [
  { id: 'ff', label: 'Full frame', w: 36, h: 24 },
  { id: 'apsc', label: 'APS-C', w: 23.6, h: 15.7 },
  { id: 'mft', label: 'M 4/3', w: 17.3, h: 13 },
  { id: 'one', label: '1"', w: 13.2, h: 8.8 },
  { id: 's35', label: 'Super 35', w: 24.9, h: 18.7 },
  { id: 'custom', label: 'Свой', w: 36, h: 24 },
];

export const FOCAL_MIN = 4;
export const FOCAL_MAX = 1200;
export const FOV_MIN = 1.2;
export const FOV_MAX = 140;

/** Размер сенсора по выбранной базе, мм. */
export function sensorDim(sensor, basis) {
  return basis === 'horizontal' ? sensor.w : sensor.h;
}

/** Фокусное (мм) из угла поля зрения (град). */
export function focalFromFov(fovDeg, sensor, basis) {
  const d = sensorDim(sensor, basis);
  return d / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** Угол поля зрения (град) из фокусного (мм). */
export function fovFromFocal(focalMm, sensor, basis) {
  const d = sensorDim(sensor, basis);
  return (2 * Math.atan(d / (2 * focalMm)) * 180) / Math.PI;
}

export const clampFocal = (mm) => Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, mm));
export const clampFov = (deg) => Math.min(FOV_MAX, Math.max(FOV_MIN, deg));

/**
 * Слider для фокусного: равномерная шкала в миллиметрах неудобна —
 * 12→24 и 200→400 должны ощущаться одинаково, поэтому логарифм.
 */
export function focalToSlider(mm, min = FOCAL_MIN, max = FOCAL_MAX) {
  const t = (Math.log(clampFocal(mm)) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.min(1, Math.max(0, t)) * 1000;
}

export function sliderToFocal(v, min = FOCAL_MIN, max = FOCAL_MAX) {
  const t = Math.min(1000, Math.max(0, v)) / 1000;
  return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
}

/** Удобное форматирование: «50 мм», «12.7 мм», «1350 мм». */
export function fmtFocal(mm) {
  if (!isFinite(mm)) return '—';
  const v = mm >= 100 ? Math.round(mm) : Math.round(mm * 10) / 10;
  return `${v.toLocaleString('ru-RU').replace(',0', '')} мм`;
}

export function fmtFov(deg) {
  if (!isFinite(deg)) return '—';
  return `${deg >= 10 ? Math.round(deg) : Math.round(deg * 10) / 10}°`;
}
