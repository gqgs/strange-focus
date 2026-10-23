// Keep accents readable as text on the pale focus card, including custom colors.
export function readableColor(hex, theme = 'light') {
  let rgb = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16));
  const luminance = values => values.map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  if (theme === 'dark') {
    while (luminance(rgb) < 0.5) rgb = rgb.map(value => Math.min(255, Math.ceil(value + (255 - value) * 0.08)));
  } else {
    while (luminance(rgb) > 0.14) rgb = rgb.map(value => Math.floor(value * 0.95));
  }
  return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
}

export function dominantColor(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = Array.from(pixels.slice(i, i + 3));
    if (pixels[i + 3] < 160 || Math.min(...rgb) > 235) continue;
    const saturation = (Math.max(...rgb) - Math.min(...rgb)) / 255;
    const key = rgb.map(value => Math.floor(value / 32)).join(',');
    const bucket = buckets.get(key) ?? { weight: 0, count: 0, sum: [0, 0, 0] };
    bucket.weight += 1 + saturation * 4;
    bucket.count++;
    rgb.forEach((value, j) => { bucket.sum[j] += value; });
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return null;
  return readableColor('#' + best.sum.map(value => Math.round(value / best.count).toString(16).padStart(2, '0')).join(''));
}

export async function faviconColor(taskUrl) {
  // Never send task paths, credentials, or query strings to a favicon service.
  // Domains without CORS support simply retain their existing accent.
  try {
    const response = await fetch(new URL('/favicon.ico', taskUrl), { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 1_000_000) return null;
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 32, 32);
      return dominantColor(context.getImageData(0, 0, 32, 32).data);
    } finally { bitmap.close(); }
  } catch { return null; }
}
