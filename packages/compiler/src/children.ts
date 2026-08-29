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
function stripComments(code: string): string {
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
  const IMPORT: RegExp = /import\s+([^;]*?)\s+from\s+['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = IMPORT.exec(code)) !== null) {
    if (word.test(m[1])) return true; // the binding section (before `from`) names it
  }
  return false;
}
