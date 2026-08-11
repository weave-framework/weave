/**
 * RFC 0008 `#3` — reading a component-file extension that PATCHES its base's template.
 *
 * A `#3` extension writes no template of its own. It declares `export const extend = Base` and
 * `export const patch = [ … ]`, and the ops are pure DATA so they can be read STATICALLY — without
 * evaluating the module, importing the base, or running any of the author's code.
 *
 * This lives in the compiler because two callers need the same answer and must not drift: the build
 * loader, which resolves the base template and compiles the patched result, and `weave check`, which
 * type-checks the markup a patch introduces. When the two disagreed about what an extension even was,
 * the checker's answer was "not a component" and every patched expression went unchecked.
 *
 * Offsets are carried through: {@link readPatchOps} records where each op's markup starts in the
 * ORIGINAL source, so a type error inside `html: '<b>{{ tyop }}</b>'` can be reported at the character
 * that is wrong rather than at the file. That is why comments are blanked in place rather than removed —
 * a stripper that shortens the text makes every offset after the first comment a lie.
 */

import type { PatchOp } from './patch.js';

/**
 * Blank comments IN PLACE — every comment character becomes a space, newlines survive.
 *
 * Length-preserving by construction, so an offset into the result is an offset into the original.
 * Strings (including template literals) are opaque: `'// not a comment'` stays as written.
 *
 * With `alsoStrings`, every string's CONTENTS are blanked too (the quotes stay, so the shape of the code
 * is unchanged). That answers a different question — "does this identifier appear as code?" — for which
 * a name inside a string literal is a false yes. Regex literals are deliberately not special-cased:
 * treating one as code can only ever keep a name, never drop one.
 */
export function blankComments(code: string, alsoStrings: boolean = false): string {
  const out: string[] = [];
  let i: number = 0;
  const n: number = code.length;
  const keep = (ch: string): string => (alsoStrings ? (ch === '\n' ? '\n' : ' ') : ch);
  while (i < n) {
    const c: string = code[i]!;
    const d: string = code[i + 1] ?? '';
    if (c === '"' || c === "'" || c === '`') {
      out.push(c);
      i++;
      while (i < n) {
        const ch: string = code[i]!;
        if (ch === '\\') {
          out.push(keep(ch), keep(code[i + 1] ?? ''));
          i += 2;
          continue;
        }
        if (ch === c) {
          out.push(ch);
          i++;
          break;
        }
        out.push(keep(ch));
        i++;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        out.push(code[i] === '\n' ? '\n' : ' ');
        i++;
      }
      out.push('  ');
      i += 2;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

/** The base identifier of a `#3` extension: `export const extend = List` → `"List"` (else null). */
export function extensionBase(script: string): string | null {
  const m: RegExpMatchArray | null = blankComments(script).match(/export\s+const\s+extend\s*=\s*([A-Za-z_$][\w$]*)/);
  return m ? m[1]! : null;
}

/** The module specifier a default import binds `name` to: `import List from './list'` → `"./list"`. */
export function defaultImportSpec(script: string, name: string): string | null {
  const code: string = blankComments(script);
  const re: RegExp = new RegExp(`import\\s+${name}\\b[^;]*?\\bfrom\\s+['"]([^'"]+)['"]`);
  const m: RegExpMatchArray | null = code.match(re);
  return m ? m[1]! : null;
}

/** Does this module declare template patches at all? (`export const patch = [ … ]`.) */
export function hasPatchDeclaration(script: string): boolean {
  return /export\s+const\s+patch\s*=/.test(blankComments(script));
}

/** The balanced `[ … ]` after `export const patch =`, with where it starts in the source. */
function patchArrayAt(script: string): { expr: string; start: number } | null {
  const code: string = blankComments(script);
  const decl: RegExpMatchArray | null = code.match(/export\s+const\s+patch\s*=/);
  if (!decl || decl.index === undefined) return null;
  const start: number = code.indexOf('[', decl.index);
  if (start === -1) return null;
  let depth: number = 0;
  let quote: string = '';
  for (let i: number = start; i < code.length; i++) {
    const c: string = code[i]!;
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return { expr: code.slice(start, i + 1), start };
  }
  return null;
}

/** Extract the balanced `[ … ]` after `export const patch =` (text only). */
export function patchArrayExpr(script: string): string | null {
  return patchArrayAt(script)?.expr ?? null;
}

/**
 * Where each op's MARKUP begins, in source order — the offset of the first character INSIDE the
 * `html:`/`attr:` string literal. `undefined` for an op that carries no markup (`remove`,
 * `removeAttr`), and for one whose markup is not a plain string literal (a template literal with a
 * `${…}` in it is not markup this can point into).
 *
 * Positional rather than by value: two ops may insert the same markup, and the second occurrence is
 * not where the second op lives.
 */
function markupOffsets(expr: string, exprStart: number): Array<number | undefined> {
  const out: Array<number | undefined> = [];
  let depth: number = 0;
  let current: number | undefined;
  let inObject: boolean = false;
  for (let i: number = 0; i < expr.length; i++) {
    const c: string = expr[i]!;
    if (c === '{') {
      depth++;
      if (depth === 1) {
        inObject = true;
        current = undefined;
      }
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth === 0 && inObject) {
        out.push(current);
        inObject = false;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // Skip the literal wholesale; note it only when it is the value of `html:`/`attr:` at this depth.
      const key: RegExpMatchArray | null = /(html|attr)\s*:\s*$/.exec(expr.slice(Math.max(0, i - 24), i));
      const start: number = i + 1;
      let j: number = i + 1;
      while (j < expr.length) {
        if (expr[j] === '\\') {
          j += 2;
          continue;
        }
        if (expr[j] === c) break;
        j++;
      }
      if (key && depth === 1 && current === undefined) current = exprStart + start;
      i = j;
      continue;
    }
  }
  return out;
}

/**
 * Read the (static, literal) patch array. Each op carries `srcOffset` — where its markup sits in the
 * source — so a diagnostic inside patched markup lands on the character that is wrong.
 */
export function readPatchOps(script: string, filename: string): PatchOp[] {
  const found: { expr: string; start: number } | null = patchArrayAt(script);
  if (!found) throw new Error(`weave: ${filename} — could not read \`export const patch = [ … ]\` (must be a static array literal).`);
  let ops: unknown;
  try {
    ops = new Function(`return (${found.expr});`)();
    if (!Array.isArray(ops)) throw new Error('not an array');
  } catch (e) {
    throw new Error(
      `weave: ${filename} — \`export const patch\` must be a STATIC array literal (plain objects/strings, no identifiers or imports): ${(e as Error).message}`
    );
  }
  const offsets: Array<number | undefined> = markupOffsets(found.expr, found.start);
  return (ops as PatchOp[]).map((op, i) => (offsets[i] === undefined ? op : { ...op, srcOffset: offsets[i] }));
}

