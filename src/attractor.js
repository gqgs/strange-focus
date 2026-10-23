// The Lorenz system, projected onto its x/z plane. A fixed trajectory gives each
// domain a recognizable shape; pending tasks travel along this trajectory.
const SVG_NS = 'http://www.w3.org/2000/svg';
let cachedPoints;

function trajectory() {
  if (cachedPoints) return cachedPoints;
  let x = 0.1, y = 0, z = 0;
  const points = [];
  const derivative = ([a, b, c]) => [10 * (b - a), a * (28 - c) - b, a * b - (8 / 3) * c];
  const step = (v, k, scale) => v.map((n, i) => n + k[i] * scale);
  for (let i = 0; i < 5000; i++) {
    const v = [x, y, z], dt = 0.008;
    const a = derivative(v);
    const b = derivative(step(v, a, dt / 2));
    const c = derivative(step(v, b, dt / 2));
    const d = derivative(step(v, c, dt));
    [x, y, z] = v.map((n, j) => n + dt * (a[j] + 2 * b[j] + 2 * c[j] + d[j]) / 6);
    if (i > 700 && i % 2 === 0) points.push([x, z]);
  }
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  cachedPoints = points.map(([a, b]) => [20 + (a - minX) / (maxX - minX) * 300, 170 - (b - minZ) / (maxZ - minZ) * 150]);
  return cachedPoints;
}

export function createAttractor(color, { detail = false, tasks = [], selectedTaskId = null } = {}) {
  const points = trajectory();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 340 190');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', detail ? '0.65' : '0.9');
  path.setAttribute('stroke-opacity', detail ? '0.48' : '0.64');
  svg.append(path);
  const visible = tasks.slice(0, 60);
  if (selectedTaskId && !visible.some(task => task.id === selectedTaskId)) {
    const selected = tasks.find(task => task.id === selectedTaskId);
    if (selected) visible.splice(visible.length - 1, 1, selected);
  }
  const dots = visible.map(task => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'task-orbit-dot');
    dot.dataset.taskId = task.id;
    dot.setAttribute('r', task.id === selectedTaskId ? '5' : '3.2');
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#fff');
    dot.setAttribute('stroke-width', task.id === selectedTaskId ? '2' : '0.8');
    const offset = [...task.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) / 4294967296;
    positionDot(dot, points, offset);
    svg.append(dot);
    return { dot, offset };
  });
  svg.dataset.taskCount = tasks.length;
  if (dots.length) {
    moving.add({ svg, points, dots });
    startMotion();
  }
  return svg;
}

const moving = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let frame = null;
export function clearAttractorAnimations() {
  moving.clear();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}
function positionDot(dot, points, phase) {
  const cycle = (phase % 1) * 2;
  const index = (cycle <= 1 ? cycle : 2 - cycle) * (points.length - 1);
  const a = points[Math.floor(index)], b = points[Math.min(Math.floor(index) + 1, points.length - 1)];
  const mix = index % 1;
  dot.setAttribute('cx', (a[0] + (b[0] - a[0]) * mix).toFixed(2));
  dot.setAttribute('cy', (a[1] + (b[1] - a[1]) * mix).toFixed(2));
}
function animate(time) {
  frame = null;
  for (const item of moving) {
    if (!item.svg.isConnected) { moving.delete(item); continue; }
    for (const { dot, offset } of item.dots) positionDot(dot, item.points, offset + time / 90000);
  }
  startMotion();
}
function startMotion() {
  if (frame === null && moving.size && !document.hidden && !reducedMotion.matches) frame = requestAnimationFrame(animate);
}
function syncMotion() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  startMotion();
}
reducedMotion.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);
