// The Lorenz system, projected onto its x/z plane. A fixed trajectory gives each
// domain a recognizable, still shape rather than distracting continuous motion.
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

export function createAttractor(color, { detail = false, selected = false } = {}) {
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
  if (selected) {
    const [cx, cy] = points[1460];
    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('cx', cx); halo.setAttribute('cy', cy); halo.setAttribute('r', '10'); halo.setAttribute('fill', color); halo.setAttribute('fill-opacity', '0.13');
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '4'); dot.setAttribute('fill', color); dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '1.5');
    svg.append(halo, dot);
  }
  return svg;
}
