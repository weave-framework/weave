/**
 * One way to print a diagnostic — shared by `weave check`, `weave build --check` and the dev server's
 * after-rebuild check, so the sentence a developer sees in the terminal is the one they see in the page.
 */

import type { Diagnostic } from '@weave-framework/check';

/** `file:line:col - category TScode: message` — the shape editors parse and people grep. */
export function formatDiagnostic(d: Diagnostic): string {
  // TS diagnostics carry a `TS<code>`; a template parse error (code 0) has none.
  const code: string = d.code ? ` TS${d.code}` : '';
  return `${d.file}:${d.line}:${d.col} - ${d.category}${code}: ${d.message}`;
}
