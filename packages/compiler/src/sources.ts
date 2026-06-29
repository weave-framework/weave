/**
 * Static extraction of a component's template/styles *source declarations* from
 * its `.ts` script. Pure string work — no filesystem, no evaluation — so the dev
 * plugin, the one-shot build, `tools/verify-build.mjs`, and `@weave/check` can all
 * share one definition of the authoring contract. Lives in the compiler (the
 * shared base) to avoid a cli↔check dependency cycle.
 *
 * A component `.ts` may declare where its template and styles come from:
 *
 * ```ts
 * export const template = `<h1>{title()}</h1>`;   // inline (markup/binding present)
 * export const template = './custom.html';        // external file (path-shaped)
 * export const styles = ['./a.scss', './b.scss']; // many files, cascade order
 * ```
 *
 * One field each — {@link classifyTemplate}/{@link classifyStyle} decide *inline vs
 * file* by shape, so there is no `templateUrl`/`styleUrls` split. The declarations
 * are build-time metadata: {@link extractSources} returns the script with them
 * **blanked** (same-length whitespace, newlines kept) so line numbers — and thus
 * error offsets — are preserved, exactly like `parseSfcLoc`. For an inline template
 * it also returns the value's `[start, end)` offsets, so `@weave/check` can build a
 * location-faithful template via {@link faithfulTemplate} and map diagnostics back
 * to the `.ts` line:col.
 */

export interface ExtractedSources {
  /** Raw `template` value (file path or inline markup), or undefined if not declared. */
  template?: string;
  /** For an inline `template`, the `[start, end)` offsets of its raw content in the source. */
  templateRange?: [number, number];
  /** Raw `styles` values (each a file path or inline CSS), or undefined if not declared. */
  styles?: string[];
  /** The script with the `template`/`styles` declarations blanked out. */
  script: string;
}

// Allow an optional type annotation (`: string`, `: string[]`, …) — the project's
// lint requires one — between the name and `=`.
const DECL: RegExp = /export\s+const\s+(template|styles)\s*(?::[^=]+)?=\s*/g;

/**
 * Pull the `template`/`styles` declarations out of a component script. Throws on a
 * non-static value (anything but a string literal or an array of string literals)
 * and on `${…}` interpolation inside a backtick literal (Weave binds with `{expr}`,
 * not JS `${expr}`).
 */
export function extractSources(script: string): ExtractedSources {
  let template: string | undefined;
  let templateRange: [number, number] | undefined;
  let styles: string[] | undefined;
  const blanks: Array<[number, number]> = [];

  DECL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL.exec(script)) !== null) {
    const kind: string = m[1];
    const valueStart: number = m.index + m[0].length;
    const parsed: ParsedLiteral = parseLiteral(script, valueStart, kind);
    if (kind === 'template') {
      if (Array.isArray(parsed.value)) throw new Error('weave: `template` must be a single string, not an array');
      template = parsed.value;
      if (parsed.innerStart !== undefined && parsed.innerEnd !== undefined) {
        templateRange = [parsed.innerStart, parsed.innerEnd];
      }
    } else {
      styles = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
    }
    // Blank from `export` through the literal and an optional trailing `;`.
    let end: number = parsed.end;
    while (end < script.length && /\s/.test(script[end]) && script[end] !== '\n') end++;
    if (script[end] === ';') end++;
    blanks.push([m.index, end]);
    DECL.lastIndex = end;
  }

  return { template, templateRange, styles, script: blanks.length ? blank(script, blanks) : script };
}

interface ParsedLiteral {
  value: string | string[];
  /** Offset just past the literal. */
  end: number;
  /** For a single string literal, the raw content offsets between the quotes. */
  innerStart?: number;
  innerEnd?: number;
}

/** Parse a string literal or an array of string literals starting at `i` (after `=`). */
function parseLiteral(src: string, i: number, kind: string): ParsedLiteral {
  i = skipWs(src, i);
  const c: string = src[i];
  if (c === '"' || c === "'" || c === '`') return parseString(src, i);
  if (c === '[') return parseArray(src, i);
  throw new Error(`weave: \`${kind}\` must be a static string${kind === 'styles' ? ' or array of strings' : ''}`);
}

/** Parse one quoted string literal (any of `' " \``); rejects `${…}` in backticks. */
function parseString(src: string, i: number): ParsedLiteral {
  const quote: string = src[i];
  const innerStart: number = i + 1;
  let out: string = '';
  let j: number = innerStart;
  for (; j < src.length; j++) {
    const ch: string = src[j];
    if (ch === '\\') {
      out += src[j + 1] ?? '';
      j++;
      continue;
    }
    if (quote === '`' && ch === '$' && src[j + 1] === '{') {
      throw new Error('weave: inline template/styles cannot use ${…} — Weave binds with {expr}, not JS interpolation');
    }
    if (ch === quote) return { value: out, end: j + 1, innerStart, innerEnd: j };
    out += ch;
  }
  throw new Error('weave: unterminated string literal in template/styles declaration');
}

/** Parse `[ "a", 'b', `c` ]` into a string array. */
function parseArray(src: string, i: number): ParsedLiteral {
  const items: string[] = [];
  let j: number = i + 1; // past '['
  for (;;) {
    j = skipWs(src, j);
    if (src[j] === ']') return { value: items, end: j + 1 };
    if (j >= src.length) throw new Error('weave: unterminated array in styles declaration');
    if (src[j] === ',') {
      j++;
      continue;
    }
    const str: ParsedLiteral = parseString(src, j);
    items.push(str.value as string);
    j = str.end;
  }
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Replace the given ranges with same-length whitespace, preserving newlines. */
function blank(src: string, ranges: Array<[number, number]>): string {
  let out: string = '';
  let cursor: number = 0;
  for (const [start, end] of ranges) {
    out += src.slice(cursor, start);
    for (let k: number = start; k < end; k++) out += src[k] === '\n' ? '\n' : ' ';
    cursor = end;
  }
  return out + src.slice(cursor);
}

/**
 * Build a location-faithful template text from a `.ts` source: everything outside
 * `range` becomes same-length whitespace (newlines kept), so offsets into the result
 * equal offsets into the original `.ts` — the inline-template analogue of `parseSfcLoc`.
 */
export function faithfulTemplate(source: string, range: [number, number]): string {
  let out: string = '';
  for (let i: number = 0; i < source.length; i++) {
    out += i >= range[0] && i < range[1] ? source[i] : source[i] === '\n' ? '\n' : ' ';
  }
  return out;
}

/** Does this `template` value carry markup/binding (→ inline) rather than name a file? */
export function classifyTemplate(value: string): 'inline' | 'file' {
  if (/[<{}\n]/.test(value)) return 'inline';
  if (/[\\/]/.test(value) || /\.html$/i.test(value)) return 'file';
  return 'inline'; // short, path-less text (e.g. "Hello") is inline content
}

/** Does this `styles` entry carry CSS (→ inline) rather than name a file? */
export function classifyStyle(value: string): 'inline' | 'file' {
  if (/[{}\n]/.test(value)) return 'inline';
  if (/[\\/]/.test(value) || /\.(css|scss|sass)$/i.test(value)) return 'file';
  return 'inline';
}
