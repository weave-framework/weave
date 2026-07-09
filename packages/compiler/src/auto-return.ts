/**
 * Auto-expose — synthesize `setup`'s `return` when the author omits it.
 *
 * A component's template can only read what `setup()` returns; historically every
 * component ended with a hand-written `return { … }` mirror of its bindings. When
 * that `return` is absent, {@link injectAutoReturn} inserts one that exposes
 * exactly the names the template references (`inferCtxNames`). Both compile paths
 * apply the SAME transform — the loader (runtime module) and `@weave-framework/check`
 * (the `ReturnType<typeof setup>` context type) — so the runtime context object and
 * the type-checked context stay identical.
 *
 * Exposing only the template-referenced names (not "every top-level binding") means
 * a private helper or timer is never leaked, and a module-scope name the template
 * uses (`t`, an icon map) is forwarded for free because it is already in `setup`'s
 * lexical scope.
 *
 * FAIL-SAFE by construction: a `return` is injected ONLY when the setup body is
 * located with confidence AND no top-level `return` statement is found. Any
 * ambiguity (unusual signature, a return-type annotation, an unbalanced scan)
 * leaves the script byte-for-byte untouched — so every existing component (all of
 * which return explicitly) is unaffected.
 *
 * Hand-rolled scanner (no TypeScript dependency, per the zero-dep rule): strings,
 * template literals, comments and regex literals are skipped as opaque; each `{` is
 * classified FUNCTION vs BLOCK so a `return` inside a nested function/arrow is
 * ignored while one inside a top-level `if`/`for`/`switch` block still counts as an
 * explicit return.
 */

const WS: RegExp = /\s/;
const ID_CHAR: RegExp = /[A-Za-z0-9_$]/;
const ID_START: RegExp = /[A-Za-z_$]/;

const SETUP_FN: RegExp = /export\s+(?:async\s+)?function\s+setup\b/;
const SETUP_VAR: RegExp = /export\s+(?:const|let|var)\s+setup\s*=/;

/** Keywords whose `( … )` is a control-flow head — the following `{` is a block, not a function body. */
const CONTROL_KW: Set<string> = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
/** Tokens after which a `/` begins a regex literal (rather than division). */
const REGEX_PRECEDING_KW: Set<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case',
]);

export interface AutoReturnResult {
  /** The (possibly transformed) script. */
  code: string;
  /** When a `return` was injected: the offset in the ORIGINAL script where the injected text begins. */
  injectedAt?: number;
  /** When a `return` was injected: the character length of the injected text. */
  injectedLen?: number;
}

/**
 * Inject `return { …names }` at the end of `setup`'s body when it has no explicit
 * top-level return. Returns the script unchanged (no offsets) when `names` is empty,
 * when the body can't be confidently located, or when a top-level return exists.
 */
export function injectAutoReturn(script: string, names: string[]): AutoReturnResult {
  if (names.length === 0) return { code: script };
  const open: number | null = locateSetupBodyOpen(script);
  if (open === null) return { code: script }; // unlocatable / concise arrow / annotated → leave as-is
  const scan: BodyScan | null = scanBody(script, open);
  if (scan === null || scan.hasTopReturn) return { code: script };
  const inserted: string = `\n  return { ${names.join(', ')} };\n`;
  const at: number = scan.closeIndex; // insert just before the body-closing '}'
  return {
    code: script.slice(0, at) + inserted + script.slice(at),
    injectedAt: at,
    injectedLen: inserted.length,
  };
}

/* ──────────── locate the setup body's opening brace ──────────── */

/**
 * Offset of `setup`'s body-opening `{`, or null when it can't be located with
 * confidence (in which case no transform is applied). A concise arrow body
 * (`setup = () => ({ … })`, an implicit return) and any return-type annotation
 * also yield null — both already return, so skipping them is correct.
 */
function locateSetupBodyOpen(src: string): number | null {
  const fn: RegExpExecArray | null = SETUP_FN.exec(src);
  if (fn) {
    let i: number = skipWs(src, fn.index + fn[0].length);
    if (src[i] !== '(') return null;
    const rp: number = matchDelimited(src, i, '(', ')');
    if (rp < 0) return null;
    i = skipWs(src, rp + 1);
    return src[i] === '{' ? i : null; // a `:` return-type annotation → null (fail-safe)
  }

  const v: RegExpExecArray | null = SETUP_VAR.exec(src);
  if (v) {
    let i: number = skipWs(src, v.index + v[0].length);
    if (startsWithWord(src, i, 'async')) i = skipWs(src, i + 5);
    if (startsWithWord(src, i, 'function')) {
      i = skipWs(src, i + 8);
      if (src[i] !== '(') return null;
      const rp: number = matchDelimited(src, i, '(', ')');
      if (rp < 0) return null;
      i = skipWs(src, rp + 1);
      return src[i] === '{' ? i : null;
    }
    // Arrow: find the `=>` at expression depth 0, then classify block vs concise body.
    const arrow: number = findArrow(src, i);
    if (arrow < 0) return null;
    const b: number = skipWs(src, arrow + 2);
    return src[b] === '{' ? b : null; // `=> {` block body; `=> (` / `=> expr` is a concise return
  }

  return null;
}

/** Find the `=>` of an arrow at depth 0 starting from `i`, skipping opaque + nested delimiters. -1 if none. */
function findArrow(src: string, i: number): number {
  let depth: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=' && src[i + 1] === '>') return i;
    else if (depth === 0 && (c === ';' || c === ',')) return -1; // ran past the initializer
    i++;
  }
  return -1;
}

/* ──────────── scan the setup body for its close + a top-level return ──────────── */

interface BodyScan {
  /** Offset of the body-closing `}`. */
  closeIndex: number;
  /** Whether a `return` statement appears at the top level of the setup body (not inside a nested fn). */
  hasTopReturn: boolean;
}

/**
 * Scan `setup`'s body starting at its opening `{` (`open`). Tracks a stack of brace
 * kinds so `hasTopReturn` counts a `return` only while the innermost open function
 * scope is the setup body itself (nested arrows/functions are excluded, but top-level
 * `if`/`for`/`switch` blocks are not). Returns null on an unbalanced/uncertain scan.
 */
function scanBody(src: string, open: number): BodyScan | null {
  const kinds: boolean[] = [true]; // true = FUNCTION scope; the setup body itself is one
  const parenKw: string[] = []; // keyword preceding each open '(' (for `){` classification)
  let lastParenKw: string = '';
  let prevTok: string = ''; // last significant token (identifier text, or a punctuator like '=>' / ')')
  const n: number = src.length;
  let i: number = open + 1;

  const funcDepth = (): number => {
    let d: number = 0;
    for (const k of kinds) if (k) d++;
    return d;
  };

  while (i < n) {
    const op: number = skipOpaque(src, i, prevTok);
    if (op > i) {
      i = op;
      prevTok = 'x'; // a string/template/regex is a value → following `/` is division
      continue;
    }
    const c: string = src[i];

    if (WS.test(c)) {
      i++; // whitespace never changes the previous significant token
      continue;
    }

    if (ID_START.test(c)) {
      let j: number = i + 1;
      while (j < n && ID_CHAR.test(src[j])) j++;
      const word: string = src.slice(i, j);
      if (word === 'return' && prevTok !== '.' && funcDepth() === 1) {
        return { closeIndex: findClose(src, open), hasTopReturn: true };
      }
      prevTok = word;
      i = j;
      continue;
    }

    if (c === '=' && src[i + 1] === '>') {
      prevTok = '=>';
      i += 2;
      continue;
    }

    if (c === '(') {
      parenKw.push(prevTok);
      prevTok = '(';
      i++;
      continue;
    }
    if (c === ')') {
      lastParenKw = parenKw.pop() ?? '';
      prevTok = ')';
      i++;
      continue;
    }
    if (c === '{') {
      // Classify the scope this `{` opens: an arrow body (`=> {`) or a
      // function/method body (`){` whose paren was NOT a control head) is a
      // FUNCTION; everything else (blocks, object literals) is not.
      let isFunc: boolean = false;
      if (prevTok === '=>') isFunc = true;
      else if (prevTok === ')') isFunc = !CONTROL_KW.has(lastParenKw);
      kinds.push(isFunc);
      prevTok = '{';
      i++;
      continue;
    }
    if (c === '}') {
      kinds.pop();
      if (kinds.length === 0) return { closeIndex: i, hasTopReturn: false };
      prevTok = '}';
      i++;
      continue;
    }

    prevTok = c;
    i++;
  }
  return null; // unbalanced — never found the body close
}

/** Offset of the body-closing `}` for the block opened at `open` (used once a top-level return is known). */
function findClose(src: string, open: number): number {
  let depth: number = 0;
  let i: number = open;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return n; // unreachable for a balanced body
}

/* ──────────── opaque-region skipper (strings / templates / comments / regex) ──────────── */

/**
 * If an opaque region starts at `i` — a line/block comment, a `'`/`"`/`` ` ``
 * string (template literals include nested `${ … }`), or a regex literal (only
 * when `prevTok` permits one) — return the offset just past it; otherwise return
 * `i` unchanged. `prevTok` disambiguates `/` (regex vs division); omit it where a
 * regex can't occur.
 */
function skipOpaque(src: string, i: number, prevTok: string = ''): number {
  const c: string = src[i];
  const d: string = src[i + 1];
  if (c === '/' && d === '/') {
    let j: number = i + 2;
    while (j < src.length && src[j] !== '\n') j++;
    return j;
  }
  if (c === '/' && d === '*') {
    let j: number = i + 2;
    while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
    return Math.min(j + 2, src.length);
  }
  if (c === '"' || c === "'") return scanString(src, i);
  if (c === '`') return scanTemplate(src, i);
  if (c === '/' && startsRegex(prevTok)) return scanRegex(src, i);
  return i;
}

/** Whether a `/` at a position preceded by `prevTok` begins a regex literal (vs division). */
function startsRegex(prevTok: string): boolean {
  if (prevTok === '') return true;
  if (REGEX_PRECEDING_KW.has(prevTok)) return true;
  const last: string = prevTok[prevTok.length - 1];
  if (ID_CHAR.test(last)) return false; // identifier / number / value-keyword → division
  if (last === ')' || last === ']') return false; // grouping / index → division
  return true; // any other operator or punctuator → regex
}

function scanString(src: string, start: number): number {
  const quote: string = src[start];
  let i: number = start + 1;
  const n: number = src.length;
  while (i < n) {
    const c: string = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return n;
}

/** Scan a `` ` … ` `` template literal, recursing through each `${ … }` interpolation. */
function scanTemplate(src: string, start: number): number {
  let i: number = start + 1;
  const n: number = src.length;
  while (i < n) {
    const c: string = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      i += 2;
      let depth: number = 1;
      while (i < n && depth > 0) {
        const op: number = skipOpaque(src, i);
        if (op > i) {
          i = op;
          continue;
        }
        const m: string = src[i];
        if (m === '{') depth++;
        else if (m === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return n;
}

function scanRegex(src: string, start: number): number {
  let i: number = start + 1;
  const n: number = src.length;
  let inClass: boolean = false;
  while (i < n) {
    const c: string = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < n && ID_CHAR.test(src[i])) i++; // trailing flags
      return i;
    } else if (c === '\n') return start + 1; // not a regex after all — bail without consuming
    i++;
  }
  return n;
}

/* ──────────── small helpers ──────────── */

function skipWs(src: string, i: number): number {
  while (i < src.length && WS.test(src[i])) i++;
  return i;
}

function startsWithWord(src: string, i: number, word: string): boolean {
  if (src.slice(i, i + word.length) !== word) return false;
  const after: string = src[i + word.length];
  return after === undefined || !ID_CHAR.test(after);
}

/** Offset of the delimiter matching the `open` char at `i` (e.g. `(`→`)`), or -1. Skips opaque regions. */
function matchDelimited(src: string, i: number, open: string, close: string): number {
  let depth: number = 0;
  const n: number = src.length;
  while (i < n) {
    const op: number = skipOpaque(src, i);
    if (op > i) {
      i = op;
      continue;
    }
    const c: string = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
