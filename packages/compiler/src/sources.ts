/**
 * Static extraction of a component's template/styles *source declarations* from
 * its `.ts` script. Pure string work — no filesystem, no evaluation — so the dev
 * plugin, the one-shot build, `tools/verify-build.mjs`, and `@weave-framework/check` can all
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
 * it also returns the value's `[start, end)` offsets, so `@weave-framework/check` can build a
 * location-faithful template via {@link faithfulTemplate} and map diagnostics back
 * to the `.ts` line:col.
 */

import { blankComments } from './extension.js';

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

/**
 * The declaration HEAD only — up to the `:` of an optional type annotation, or the `=` itself.
 *
 * The annotation is deliberately NOT part of the pattern. Matching it as `(?::[^=\n]+)?` put two
 * quantifiers that both accept whitespace (`\s*` and `[^=\n]+`) either side of an optional group, which
 * is a polynomial-backtracking shape: on `export const template` followed by a run of spaces and no `=`,
 * the engine retries every split of that run, at every start position. CodeQL flagged it
 * (`js/polynomial-redos`), and it is a real input — the scan runs over a user's own source file.
 *
 * Whatever follows the `:` is found by {@link assignmentAt}, a linear scan with no backtracking at all.
 */
const DECL: RegExp = /export\s+const\s+(template|styles)\s*[:=]/g;

/**
 * Offset of a declaration's assignment `=`, starting from just after its `:`. -1 if the line has none.
 *
 * `=>` is skipped: a type annotation routinely contains one (`: Record<string, () => Node>`), and taking
 * that for the assignment would read the annotation's tail as the value.
 */
function assignmentAt(src: string, from: number): number {
  for (let i: number = from; i < src.length; i++) {
    const c: string = src[i];
    if (c === '\n') return -1; // the annotation is a single line; anything else is not a declaration we read
    if (c !== '=') continue;
    if (src[i + 1] === '>') {
      i++; // an arrow inside the annotation
      continue;
    }
    return i;
  }
  return -1;
}

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

  // Scan a copy with comments and string CONTENTS blanked, so a declaration quoted inside a string is
  // not read as one. A module holding Weave examples as text — every generated docs page does — otherwise
  // threw `\`template\` must be a static string` on prose, and one such file aborted the whole
  // `weave check` with a stack trace. Blanking is length-preserving, so every offset still indexes the
  // ORIGINAL, which is what the values below are parsed out of.
  const scan: string = blankComments(script, true);

  DECL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL.exec(scan)) !== null) {
    const kind: string = m[1];
    const head: number = m.index + m[0].length; // just past the `:` or the `=`
    // The head stopped at whichever came first. On a `:` the assignment is found by a linear scan; a
    // declaration with no `=` on that line (`export const template: string;`) is not one to read.
    const eq: number = scan[head - 1] === '=' ? head - 1 : assignmentAt(scan, head);
    if (eq === -1) {
      DECL.lastIndex = head;
      continue;
    }
    const valueStart: number = eq + 1;
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
  i = skipTrivia(src, i);
  const c: string = src[i];
  if (c === '"' || c === "'" || c === '`') return parseConcat(src, i);
  if (c === '[') return parseArray(src, i);
  throw new Error(`weave: \`${kind}\` must be a static string${kind === 'styles' ? ' or array of strings' : ''}`);
}

/**
 * Parse one or more string literals joined by `+` — a static concatenation like
 * `'<button' + ' class="x">'` (how components often split a long template across lines
 * for readability). Returns the joined value. The `innerStart`/`innerEnd` content range
 * is only meaningful for a SINGLE literal (a faithful sub-range of a concatenation doesn't
 * exist), so it is dropped once a `+` joins a second piece. A `+` followed by anything
 * other than another string literal is a non-static template — fail loud.
 */
function parseConcat(src: string, i: number): ParsedLiteral {
  const first: ParsedLiteral = parseString(src, i);
  let value: string = first.value as string;
  let end: number = first.end;
  let single: boolean = true;
  for (;;) {
    const plus: number = skipTrivia(src, end);
    if (src[plus] !== '+') break;
    const nextStart: number = skipTrivia(src, plus + 1);
    const c: string = src[nextStart];
    if (c !== '"' && c !== "'" && c !== '`') {
      throw new Error('weave: `template`/`styles` must be a static string — `+` may only join string literals');
    }
    const next: ParsedLiteral = parseString(src, nextStart);
    value += next.value as string;
    end = next.end;
    single = false;
  }
  return single ? { value, end, innerStart: first.innerStart, innerEnd: first.innerEnd } : { value, end };
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
    j = skipTrivia(src, j);
    if (src[j] === ']') return { value: items, end: j + 1 };
    if (j >= src.length) throw new Error('weave: unterminated array in styles declaration');
    if (src[j] === ',') {
      j++;
      continue;
    }
    const str: ParsedLiteral = parseConcat(src, j);
    items.push(str.value as string);
    j = str.end;
  }
}

/**
 * Skip whitespace **and comments** — everything JS calls trivia.
 *
 * Comments have to be skipped, not merely tolerated. A template is routinely split across lines
 * with `+` (all 30 ui components do it), and annotating one of those lines is the next thing an
 * author reaches for — but the `+` scan below saw the `/` and reported "`template` must be a static
 * string" about a template that is entirely static, which reads as the compiler being wrong.
 *
 * Called only BETWEEN tokens (after `=`, around a `+`, inside a `[…]`), never inside a literal:
 * `parseString` has already consumed anything quoted. So a `/` in these positions can only open a
 * comment — there is no regex-vs-division ambiguity to resolve.
 */
function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const close: number = src.indexOf('*/', i + 2);
      // Unterminated: consume to the end so the caller reports the missing piece it was looking
      // for (an unterminated literal, a missing `]`) rather than this scan looping.
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    return i;
  }
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
