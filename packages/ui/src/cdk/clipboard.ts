/**
 * Clipboard — copy text with the async Clipboard API, falling back to a hidden
 * `<textarea>` + `execCommand('copy')` where the API is unavailable or blocked.
 * Returns whether the copy succeeded. Zero-dep.
 */

/** Copy `text` to the clipboard. Resolves `true` on success, `false` otherwise. */
export async function copy(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / not focused — fall back below.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea: HTMLTextAreaElement = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(textarea);
  textarea.select();
  let ok: boolean = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}
