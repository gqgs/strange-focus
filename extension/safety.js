// Executed in the page's isolated world. Fail closed for editors or embedded
// frames we cannot inspect. A native navigation below also honors beforeunload.
export function safeToLeave(expectedUrl) {
  if (location.href !== expectedUrl) return false;
  if (document.querySelector('iframe, frame')) return false;
  if (document.querySelector('[contenteditable]:not([contenteditable="false"])')) return false;
  for (const input of document.querySelectorAll('input, textarea, select')) {
    if (input.tagName === 'SELECT') {
      if ([...input.options].some(option => option.selected !== option.defaultSelected)) return false;
    } else if (input.type === 'file' ? input.files.length : ['checkbox', 'radio'].includes(input.type) ? input.checked !== input.defaultChecked : input.value !== input.defaultValue) return false;
  }
  return true;
}
