/**
 * Does a component's script already import a name? — half of how a PascalCase tag finds its module.
 *
 * It lives here because BOTH sides need the same answer: the build loader wires the import itself when a
 * template composes `<TodoItem>` and the script does not import it, and `weave check` has to agree, or it
 * reports `Cannot find name 'TodoItem'` about an app that builds and runs.
 *
 * The other half — probing the filesystem for the module — is deliberately NOT here: this package stays
 * free of any environment (it is bundled into browsers by the test suite and the playground). That half is
 * `resolveChildModule` in @weave-framework/check, which both the checker and the CLI import.
 */

/**
 * Blank out `//` line and block comments, preserving string/template literals so a `//`
 * or `/*` INSIDE a string (a URL, a regex-ish literal) is not mistaken for a comment. Used
 * before scanning for real `import` statements — a component's JSDoc often shows an
 * `import Child from '…'` usage example (e.g. Table's `<Checkbox>` note), which must NOT be
 * read as an actual import or the auto-resolver would skip wiring the composed child (it
 * would then mount to a swallowed ReferenceError → blank render).
 */
export function stripComments(code: string): string {
  let out: string = '';
  let i: number = 0;
  const n: number = code.length;
  while (i < n) {
    const c: string = code[i];
    const d: string = code[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      const quote: string = c;
      out += c;
      i++;
      while (i < n) {
        const ch: string = code[i];
        if (ch === '\\') {
          out += ch + (code[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += ch;
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Does the component's own script already import a binding named `name`? (explicit wins).
 *  Scans comment-free code so a documented `import Child from '…'` example doesn't count. */
export function importsBinding(script: string | undefined, name: string): boolean {
  if (!script) return false;
  const code: string = stripComments(script);
  const word: RegExp = new RegExp(`\\b${name}\\b`);

  // Located first, then read statement by statement. The single regex this replaces —
  // `import\s+([^;]*?)\s+from\s+['"][^'"]+['"]` — let a run of whitespace split three ways between its
  // two `\s+` and the lazy group, so `import` followed by spaces and no `from` was retried over every
  // split: 8,000 spaces took 59 SECONDS (CodeQL js/polynomial-redos). Each statement below is a slice
  // that ends where the next one begins, so every scan is over disjoint text and the whole pass is linear.
  const HEAD: RegExp = /\bimport\b/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = HEAD.exec(code)) !== null) starts.push(m.index);

  for (let i: number = 0; i < starts.length; i++) {
    // A statement ends at its `;` or where the next `import` starts — semicolon-less code is real,
    // and without the second bound two adjacent imports would read as one and hide the second binding.
    const stmt: string = code.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : code.length);
    const semi: number = stmt.indexOf(';');
    const body: string = semi === -1 ? stmt : stmt.slice(0, semi);
    const from: number = body.search(/\bfrom\b/);
    if (from === -1) continue; // `import './side-effect'` and `import(…)` bind nothing
    if (!/^\s*['"]/.test(body.slice(from + 'from'.length))) continue; // `from` must introduce a path
    if (word.test(body.slice('import'.length, from))) return true; // the binding section names it
  }
  return false;
}

/**
 * Does the component's own script already provide a binding named `name`, by ANY means?
 *
 * This is the question the child-import synthesis actually needs, and {@link importsBinding} answered
 * only half of it. A wrapper component legitimately DECLARES the name it composes —
 * `const Chart = (ChartModule as …).default`, re-exported — and synthesizing an import for it produced
 * `TS2440: Import declaration conflicts with local declaration of 'Chart'` on a line the author cannot
 * edit. The build had no such error, so the checker and the build disagreed about child components.
 *
 * Erring towards "yes, it is provided" is the safe direction: skipping the import when the script does
 * not in fact bind the name yields `Cannot find name '<Tag>'`, which says what is wrong and where.
 */
export function bindsName(script: string | undefined, name: string): boolean {
  if (!script) return false;
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false; // not an identifier; nothing can bind it
  if (importsBinding(script, name)) return true;
  const code: string = stripComments(script);
  // A declaration of that name, or a rename that lands on it (`import { x as Chart }`,
  // `export { x as Chart }`). Both patterns are anchored on a keyword and bounded by a word boundary,
  // so neither can backtrack over the file.
  // A lone backslash: written as `\b` inside a template literal this would be a BACKSPACE character,
  // not a word boundary — the same escape mangling that once made `verify-authorship` unable to match
  // anything while reporting a clean repository.
  const B: string = String.fromCharCode(92);
  const w: string = `${B}b`;
  const s: string = `${B}s`;
  // Kept as separate alternatives with no optional whitespace between two `\s` quantifiers: that shape
  // lets a run of spaces be divided every possible way, which is the polynomial backtracking this
  // release removed from two other scans.
  for (const p of [
    `${w}(?:const|let|var|class|enum)${s}+${name}${w}`,
    `${w}function${s}+${name}${w}`,
    `${w}function${s}*${B}*${s}*${name}${w}`, // `function* Chart`
    `${w}as${s}+${name}${w}`, // `import { x as Chart }`, `export { x as Chart }`
  ]) {
    if (new RegExp(p).test(code)) return true;
  }
  return false;
}
