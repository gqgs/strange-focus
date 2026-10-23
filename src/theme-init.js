// Run before styles paint so a saved dark theme never flashes a light page.
(() => {
  let theme;
  try { theme = JSON.parse(localStorage.getItem('strange-focus:v1'))?.theme; } catch { /* Storage may be blocked. */ }
  document.documentElement.dataset.theme = ['light', 'dark'].includes(theme) ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
