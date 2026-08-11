/**
 * Read a `setup` declaration's TYPE PARAMETERS and its props annotation, as written.
 *
 * Every producer of a component's synthesized default export derives the props from `setup`, and all of
 * them used to do it by extraction — `Parameters<typeof setup>[0]`, or `F extends (props: infer P, …)`.
 * That is exact for an ordinary component and lossy for a generic one: applied to an UNINSTANTIATED
 * generic function type, TypeScript resolves every type parameter to `unknown`, and the declared default
 * (`T = { value: string; label: string }`) does not apply — a default is used when the function is CALLED
 * without one, not when its type is destructured.
 *
 * The cost was not merely that `Select<Option>(…)` would not compile. A template checks its props against
 * that same default export, so `options` was `unknown[]` and accepted anything at all: an array of the
 * wrong shape, of numbers, of nulls. The checking the component's author wrote `SelectProps<T>` to provide
 * was simply absent, and nothing said so. A template cannot write a type argument, so an author had no way
 * to opt out of it either.
 *
 * The parameters cannot be re-derived by substitution over `typeof setup` — the list has to be RE-DECLARED
 * — so they are read from the source and re-emitted verbatim. This lives in the compiler because two
 * producers need the same answer: the `.d.ts` the ui package ships, and the virtual module `weave check`
 * and the editor tooling type against. When those two disagree, one of them is checking a contract the
 * other does not have.
 *
 * Hand-rolled, per the zero-dependency rule, and deliberately conservative: anything it cannot read with
 * confidence comes back as `null`, which puts its caller back on today's extraction rather than on a guess.
 */

import { blankComments } from './extension.js';

/** What a `setup` declaration says about its own shape. */
export interface SetupSignature {
  /** The type-parameter list as written, WITHOUT the angle brackets (`T = { value: string }`), or null. */
  typeParams: string | null;
  /** The first parameter's type annotation as written (`SelectProps<T>`), or null when it has none. */
  propsType: string | null;
}

/** Bracket pairs whose contents are never top level. */
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };

/**
 * Index just past the balanced group opening at `i`, or -1.
 *
 * `<` is tracked like any other bracket, which is what a type-parameter list needs and what makes a
 * default such as `T = () => void` or `T extends Map<string, number>` come back whole.
 */
function matchGroup(src: string, i: number): number {
  const close: string | undefined = OPEN[src[i] ?? ''];
  if (close === undefined) return -1;
  let depth: number = 0;
  for (let j: number = i; j < src.length; j++) {
    const c: string = src[j]!;
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(src, j);
      continue;
    }
    // `=>` is not a closing angle bracket. A type parameter may default to a FUNCTION type
    // (`T extends object = () => void`), and counting that `>` as a closer ended the list early —
    // caught by the gate's own fixture, which is why there is one per declaration shape.
    if (c === '=' && src[j + 1] === '>') {
      j++;
      continue;
    }
    if (OPEN[c] !== undefined) depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') {
      depth--;
      if (depth === 0) return c === close ? j + 1 : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** Index of the closing quote of the string starting at `i`. */
function skipString(src: string, i: number): number {
  const quote: string = src[i]!;
  for (let j: number = i + 1; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === quote) return j;
  }
  return src.length;
}

/** First index at or after `i` that is not whitespace. */
function skipSpace(src: string, i: number): number {
  let j: number = i;
  while (j < src.length && /\s/.test(src[j]!)) j++;
  return j;
}

/**
 * Where `setup`'s parameter list begins — the offset of its `(` — plus its type parameters if any.
 * Handles the declaration forms the framework recognises: `export function setup`, and
 * `export const setup = (…)`/`= function (…)`/`= async …`.
 */
function locateSetup(code: string): { typeParams: string | null; parenAt: number } | null {
  const fn: RegExpExecArray | null = /export\s+(?:async\s+)?function\s+setup\b/.exec(code);
  let i: number;
  if (fn) {
    i = skipSpace(code, fn.index + fn[0].length);
  } else {
    const v: RegExpExecArray | null = /export\s+(?:const|let|var)\s+setup\s*(?::[^=]*)?=/.exec(code);
    if (!v) return null;
    i = skipSpace(code, v.index + v[0].length);
    if (code.startsWith('async', i)) i = skipSpace(code, i + 5);
    if (code.startsWith('function', i)) i = skipSpace(code, i + 8);
  }
  let typeParams: string | null = null;
  if (code[i] === '<') {
    const end: number = matchGroup(code, i);
    if (end === -1) return null;
    // A trailing comma is legal in the source (`<T = unknown,>` — the `.tsx`-safe spelling) and would
    // be re-emitted verbatim; drop it so the generated signature reads the way anyone would write it.
    typeParams = code.slice(i + 1, end - 1).trim().replace(/,$/, '');
    i = skipSpace(code, end);
  }
  return code[i] === '(' ? { typeParams, parenAt: i } : null;
}

/**
 * The first parameter's type annotation inside a parameter list, or null.
 *
 * The `:` has to be found at the list's own depth — a destructured parameter (`{ a, b }: Props`) carries
 * one inside its braces, and taking that would annotate the component with a property's type.
 */
function firstParamType(params: string): string | null {
  let depth: number = 0;
  let colon: number = -1;
  for (let i: number = 0; i < params.length; i++) {
    const c: string = params[i]!;
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(params, i);
      continue;
    }
    if (OPEN[c] !== undefined) {
      depth++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}' || c === '>') {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (c === ':' && colon === -1) colon = i;
    // The end of the FIRST parameter — everything after belongs to the next one.
    else if ((c === ',' || c === '=') && colon !== -1) return params.slice(colon + 1, i).trim() || null;
  }
  return colon === -1 ? null : params.slice(colon + 1).trim() || null;
}

/**
 * Read `setup`'s type parameters and props annotation out of a component script.
 *
 * Returns null when there is no `setup` to read, or when its shape cannot be parsed with confidence —
 * callers fall back to extraction, which is exact for the non-generic case and no worse than before for
 * anything else.
 */
export function setupSignature(script: string): SetupSignature | null {
  // Blank comments and strings first so a `setup` named in either is not mistaken for the declaration;
  // blanking is length-preserving, so every offset still indexes the original text.
  const code: string = blankComments(script, true);
  const found: { typeParams: string | null; parenAt: number } | null = locateSetup(code);
  if (!found) return null;
  const end: number = matchGroup(code, found.parenAt);
  if (end === -1) return null;
  // Sliced from the ORIGINAL: a props type may legitimately contain a string literal type (`'sm' | 'lg'`),
  // and the blanked copy exists only to find boundaries.
  const params: string = script.slice(found.parenAt + 1, end - 1);
  return { typeParams: found.typeParams, propsType: firstParamType(params) };
}

/**
 * The props type to declare for a component's synthesized default, plus the type parameters to carry.
 *
 * `null` means "keep doing what you did" — the caller's own extraction. A NON-generic component takes that
 * path deliberately: its extraction is already exact, and leaving it alone keeps its emitted default
 * byte-for-byte what it was.
 */
export function genericDefaultProps(script: string): { typeParams: string; propsType: string } | null {
  const sig: SetupSignature | null = setupSignature(script);
  if (!sig?.typeParams || !sig.propsType) return null;
  return { typeParams: sig.typeParams, propsType: sig.propsType };
}
