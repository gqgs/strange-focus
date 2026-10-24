// Executed in the page's isolated world; keep this function self-contained.
// Return true or a diagnostic code, never page content or field values.
export function safeToLeave(expectedUrl) {
  if (location.href !== expectedUrl) return 'page-changed';
  if (document.querySelector('iframe, frame')) return 'frames';
  if (document.querySelector('[contenteditable]:not([contenteditable="false"])')) return 'editor';
  // Vector initializes these autosaved reading preferences with .checked, not
  // defaultChecked. Exempt only the known controls, never the page or editor.
  const wikipedia = /(^|\.)wikipedia\.org$/.test(location.hostname);
  const preferences = {
    'vector-feature-custom-font-size': ['0', '1', '2'],
    'vector-feature-limited-width': ['0', '1'],
    'skin-theme': ['os', 'day', 'night'],
  };
  function readingPreference(input) {
    if (!wikipedia || input.tagName !== 'INPUT' || input.type !== 'radio' || !input.closest('#vector-appearance')) return false;
    return Object.entries(preferences).some(([feature, values]) => values.includes(input.value)
      && input.id === `skin-client-pref-${feature}-value-${input.value}`
      && input.name === `skin-client-pref-${feature}-group`);
  }
  for (const input of document.querySelectorAll('input, textarea, select')) {
    if (readingPreference(input)) continue;
    if (input.tagName === 'SELECT') {
      if ([...input.options].some(option => option.selected !== option.defaultSelected)) return 'edited-form';
    } else if (input.type === 'file' ? input.files.length : ['checkbox', 'radio'].includes(input.type) ? input.checked !== input.defaultChecked : input.value !== input.defaultValue) return 'edited-form';
  }
  return true;
}

