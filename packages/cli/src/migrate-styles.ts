/**
 * `weave migrate` — the classes a template uses that are styled SOMEWHERE ELSE.
 *
 * A migration carries a component's folder, and Angular pairs a component with its own `styleUrls`, so that
 * folder is usually the whole story. It stops being the whole story the moment a project keeps a shared
 * stylesheet library: half the look lives there, in no component folder at all. The converted component then
 * lands *correct* and renders unstyled — the markup is right, the class names are right, and the rules simply do
 * not exist in the target app. Nothing on screen says why, and the first guess is always that the conversion
 * broke something.
 *
 * So: collect the classes the CONVERTED template actually uses, subtract the ones its carried stylesheets
 * define, and look the rest up across the source workspace. What defines them is **named, never copied**.
 * Lifting a rule out of a stylesheet library loses everything around it — the `@use`d variables, the mixins, the
 * nesting it sat in — so a carried rule is about as likely to fail to compile as to work, and a wrong carry is
 * worse than an honest line telling you which file to open. That is the same rule the rest of this converter
 * runs on.
 *
 * Known limits, stated because a silent miss is the failure this module exists to end:
 * - a class assembled at runtime (`class="icon-{{ name }}"`, `[ngClass]` with an expression) is not a name, so
 *   it is not looked up. `[ngClass]` already carries its own TODO from the converter.
 * - `@extend .x` and `@include` bodies count as defining `.x` here. Over-reporting a file that mentions the
 *   class is a cheap error; missing the file that styles it is the expensive one.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Stylesheet suffixes worth reading. `.sass` is the indented syntax — handled without braces below. */
const SHEET_EXT: ReadonlySet<string> = new Set<string>(['.css', '.scss', '.sass', '.less']);

/** Directories never worth walking: build output, caches, and the dependency tree. */
const SKIP_DIR: ReadonlySet<string> = new Set<string>([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tmp',
  '.git',
  '.nx',
  '.angular',
  '.cache',
  '.next',
  'out-tsc',
]);

/** A stop, not a budget: a workspace this big is a wrong root, and the answer would be noise either way. */
const MAX_SHEETS: number = 4000;
/** Per file. A stylesheet past this is generated or vendored, and either way not where a human edits the look. */
const MAX_SHEET_BYTES: number = 512 * 1024;

/**
 * Stands in for a collapsed `{{ … }}`. It has to be a NON-whitespace character no class name can contain: a
 * space would split `icon-{{ kind }}-sm` into two tokens that both look like real class names, which is the
 * mistake the collapse exists to prevent. Written as an escape — a raw control byte in a source file is
 * invisible in review and makes every tool treat the file as binary.
 */
const MARK: string = '\u0000';

/** One class a template uses, and the source stylesheet(s) that define it. */
export interface ExternalStyleUse {
  /** The class name as written in the markup, without the dot. */
  cls: string;
  /** Absolute paths of the source stylesheets defining it, in walk order. */
  files: string[];
}

/**
 * The class names a converted Weave template uses, as NAMES — static `class="a b"` tokens and the `name` of
 * every `class:name={{ … }}` toggle.
 *
 * A token holding an interpolation (`logo-{{ kind }}-svg`) is dropped rather than guessed at: it is a family of
 * class names, and naming one of them would be an invention. Whole-attribute interpolation goes the same way.
 */
export function templateClassNames(html: string): string[] {
  const out: Set<string> = new Set<string>();
  // Static class attributes. Each interpolation collapses to ONE marker character first: `icon-{{ kind }}-sm` is
  // a single token, and splitting on whitespace before that turns the expression's own words into class names.
  for (const m of html.matchAll(/(?:^|[\s"'`>])class\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const value: string = (m[2] ?? m[3] ?? '').replace(/\{\{[\s\S]*?\}\}/g, MARK);
    for (const token of value.split(/\s+/)) {
      if (!token || token.includes(MARK) || token.includes('{') || token.includes('}')) continue;
      out.add(token);
    }
  }
  // `class:name={{ expr }}` — Weave toggles one class at a time, so the name is right there in the binding.
  for (const m of html.matchAll(/(?:^|[\s"'`])class:([-\w]+)\s*=/g)) out.add(m[1]!);
  return [...out];
}

/**
 * Strip what a `.` inside would otherwise be mistaken for a selector: comments and string literals.
 *
 * Newlines are preserved so the indented-Sass path below still sees its own line structure. `//` is only a
 * comment when it does not follow a `:` — `url(http://…)` inside a property value is not one.
 */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m: string, lead: string) => lead)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

/** Every `.class` inside one selector string. A leading digit is never a class — that is a decimal (`40.5em`). */
function addClasses(selector: string, into: Set<string>): void {
  for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) into.add(m[1]!);
}

/**
 * Resolve one selector against the selector it is nested in, so SCSS's `&` composition is not lost.
 *
 * `.crumbs { &__item { … } }` defines `crumbs__item`, and a scan that only saw `.crumbs` would report the file
 * as irrelevant to the very class that sent someone looking — exactly the miss this module exists to prevent.
 */
function resolveSelector(selector: string, parents: string[]): string[] {
  const parts: string[] = selector
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (!part.includes('&') || !parents.length) {
      out.push(part);
      continue;
    }
    // One `&` per parent. Capped: a deeply nested comma list multiplies, and the extra combinations add no name.
    for (const parent of parents.slice(0, 8)) out.push(part.split('&').join(parent));
  }
  return out;
}

/**
 * The class names a stylesheet DEFINES, with SCSS nesting resolved.
 *
 * An at-rule (`@media`, `@supports`, `@mixin`, `@if`) opens a block without changing what `&` refers to, so it
 * pushes its parent through unchanged — a `.crumbs { @media … { &__item { … } } }` still resolves.
 */
export function definedClassNames(source: string): Set<string> {
  const out: Set<string> = new Set<string>();
  const src: string = stripNoise(source);
  if (!src.includes('{')) {
    // Indented Sass: no braces to nest with, so a selector is a line that starts with one.
    for (const line of src.split('\n')) {
      const trimmed: string = line.trim();
      if (trimmed.startsWith('.')) addClasses(trimmed, out);
    }
    return out;
  }
  const stack: string[][] = [];
  let buf: string = '';
  for (const ch of src) {
    if (ch === '{') {
      const selector: string = buf.trim();
      buf = '';
      const parents: string[] = stack.length ? stack[stack.length - 1]! : [];
      if (selector.startsWith('@')) {
        stack.push(parents);
        continue;
      }
      const resolved: string[] = resolveSelector(selector, parents);
      for (const part of resolved) addClasses(part, out);
      stack.push(resolved);
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';') {
      buf = ''; // a declaration, not a selector — drop it rather than carry it into the next one
    } else {
      buf += ch;
    }
  }
  return out;
}

/**
 * Index every stylesheet under `root` by the classes it defines.
 *
 * Built once for a whole migration run: the answer is a property of the source workspace, not of any one
 * component, and a per-component walk of a monorepo would be the slowest thing the command does.
 */
export function indexStylesheets(root: string): Map<string, string[]> {
  const index: Map<string, string[]> = new Map<string, string[]>();
  let budget: number = MAX_SHEETS;
  const walk = (dir: string): void => {
    if (budget <= 0) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // unreadable (permissions, a broken link) — a missing file is not a reason to fail a migration
    }
    for (const name of entries) {
      if (budget <= 0) return;
      const full: string = join(dir, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIP_DIR.has(name)) walk(full);
        continue;
      }
      if (!SHEET_EXT.has(extname(name).toLowerCase())) continue;
      let css: string;
      try {
        if (statSync(full).size > MAX_SHEET_BYTES) continue;
        css = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      budget--;
      for (const cls of definedClassNames(css)) {
        const files: string[] | undefined = index.get(cls);
        if (files) {
          if (!files.includes(full)) files.push(full);
        } else index.set(cls, [full]);
      }
    }
  };
  walk(root);
  return index;
}

/**
 * The classes this template uses that its own carried stylesheets do not define, but the source workspace does.
 *
 * A class defined nowhere in the workspace is NOT reported: it comes from a global stylesheet the app already
 * loads, or from a framework, or it is dead — and naming files for it would bury the entries that mean
 * something under ones that do not.
 */
export function externalStyleUses(used: string[], own: Set<string>, index: Map<string, string[]>): ExternalStyleUse[] {
  const out: ExternalStyleUse[] = [];
  for (const cls of used) {
    if (own.has(cls)) continue;
    const files: string[] | undefined = index.get(cls);
    if (files?.length) out.push({ cls, files: [...files] });
  }
  return out.sort((a: ExternalStyleUse, b: ExternalStyleUse) => a.cls.localeCompare(b.cls));
}

/** How many source stylesheets one note names before it stops being readable. */
const MAX_NOTED_FILES: number = 6;

/**
 * The comment that goes at the top of the converted template, naming the files to look in.
 *
 * It leads with the files rather than the classes: the reader's next action is to open one, and the class list
 * is what tells them whether they opened the right one. `display` maps each path to how it should be shown
 * (relative to the source workspace, so the note is readable and carries no absolute path).
 */
export function styleNote(uses: ExternalStyleUse[], display: (file: string) => string): string {
  if (!uses.length) return '';
  const files: string[] = [...new Set(uses.flatMap((u: ExternalStyleUse) => u.files))];
  const shown: string[] = files.slice(0, MAX_NOTED_FILES).map(display);
  const more: number = files.length - shown.length;
  const classes: string[] = uses.map((u: ExternalStyleUse) => `.${u.cls}`);
  const lines: string[] = [
    `TODO(weave migrate): ${uses.length} class(es) used here are styled OUTSIDE this component, so they were`,
    '  not carried with it and this markup will render unstyled until you bring those rules over:',
    ...shown.map((f: string) => `    ${f}`),
    ...(more > 0 ? [`    … and ${more} more`] : []),
    `  The classes: ${classes.join(' ')}`,
    '  Copy the rules into this component\'s sibling stylesheet, or import that file from your app styles.',
  ];
  return `<!--\n  ${lines.join('\n  ')}\n-->\n`;
}
