/**
 * Gate: the skills must cover the real public API, and their examples must be real code.
 *
 * The skills are what an AI agent reads before writing Weave code, so an omission is not a
 * documentation gap — it is an agent that invents an API instead. This is not hypothetical:
 * on 2026-07-18 the shipped skills taught `field('', { validate })` (the real signature is
 * `field(initial, Validator[], opts)`) and claimed a `resource` fetcher re-runs when it reads a
 * signal (it cannot — the fetcher is deferred to a microtask precisely so it never tracks).
 * Both were confidently wrong, and nothing could see it.
 *
 * Two checks, both mechanical:
 *   COVERAGE — every public export of a package is named somewhere in its skill.
 *   EXAMPLES — every fenced `ts` block parses as TypeScript, and every fenced `html` block parses
 *              as a Weave template. A snippet that cannot even parse is a snippet an agent copies.
 *
 * The fence carries a promise, and that is deliberate. **```ts / ```html = real code, checked
 * here.** A signature sketch is not code — `field(initial, validators?, opts?)` is notation, and
 * demanding that it compile would force perfectly good teaching to be rewritten as something
 * clumsier. Those go in **```txt**, which this gate ignores. So: if a reader can paste it, it is
 * `ts`/`html` and it is verified; if it is shorthand, it is `txt` and it is not pretending.
 * (The first cut of this gate flagged both sketches as broken — a gate that cries wolf on correct
 * content teaches everyone to ignore it, which is the failure this repo keeps re-learning.)
 *
 * Run: `pnpm verify:skills` (add `--list` to print what each skill is missing).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseTemplate } from '../packages/compiler/src/index.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const skillsDir = join(root, 'skills');
const verbose = process.argv.includes('--list');

/** skill → the package whose exports it must cover. A skill with no package covers no exports. */
const SKILL_PACKAGE = {
  'weave-reactivity': 'runtime',
  'weave-router': 'router',
  'weave-store': 'store',
  'weave-forms': 'forms',
  'weave-i18n': 'i18n',
  'weave-data': 'data',
};

/**
 * Names deliberately not taught, with the reason. An entry here is a decision on the record —
 * not a way to make the gate quiet.
 */
const NOT_TAUGHT = {
  FORM: 'the injection key itself; users reach a form through `inject(FORM)`, which IS taught',
};

/** Public exports of a package's entry point, via the TypeScript AST (not a regex). */
function publicExports(pkg) {
  const entry = join(root, 'packages', pkg, 'src', 'index.ts');
  if (!existsSync(entry)) return [];
  const src = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set();
  const add = (n) => n && names.add(n);
  src.forEachChild((node) => {
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      // `export { a, b } from './x'` / `export { a as b }`
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) add(el.name.text);
      }
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) add(node.name?.text);
    else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) add(node.name.text);
    else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text);
    }
  });
  return [...names];
}

/** Fenced code blocks, as [lang, code, lineNumber]. */
function codeBlocks(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(\w+)/.exec(lines[i]);
    if (!m) continue;
    const start = i + 1;
    let j = start;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    out.push([m[1], lines.slice(start, j).join('\n'), start]);
    i = j;
  }
  return out;
}

/**
 * The template language has no export list, so coverage is measured against what the PARSER
 * actually accepts. A construct the compiler supports but the skill never names is a construct an
 * agent will not use — or worse, will approximate with something that does not exist.
 */
const TEMPLATE_CONSTRUCTS = {
  blocks: ['if', 'else', 'for', 'empty', 'switch', 'case', 'default', 'let', 'defer', 'placeholder', 'await', 'then', 'catch', 'snippet', 'render', 'key'],
  directives: ['on:', 'use:', 'bind:', 'class:', 'style:', 'transition:', 'in:', 'out:'],
  special: ['ref', 'show', 'bind:this'],
};

let failures = 0;
const report = (msg) => {
  console.error(`  ✖ ${msg}`);
  failures++;
};

const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('weave-'))
  .map((e) => e.name);

console.log(`skills: ${skills.length}\n`);

let totalMissing = 0;
for (const skill of skills) {
  const md = readFileSync(join(skillsDir, skill, 'SKILL.md'), 'utf8');
  const pkg = SKILL_PACKAGE[skill];

  /* ── coverage ── */
  if (pkg) {
    const exports = publicExports(pkg);
    const missing = exports.filter(
      (n) => !NOT_TAUGHT[n] && !new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(md)
    );
    totalMissing += missing.length;
    if (missing.length) {
      report(`${skill}: ${missing.length}/${exports.length} public exports of @weave-framework/${pkg} are never mentioned`);
      if (verbose) console.error(`      ${missing.join(', ')}`);
    } else {
      console.log(`  ✔ ${skill}: covers all ${exports.length} public exports of @weave-framework/${pkg}`);
    }
  }

  /* ── template-language coverage (weave-templates owns the syntax) ── */
  if (skill === 'weave-templates') {
    const missingBlocks = TEMPLATE_CONSTRUCTS.blocks.filter((b) => !md.includes(`@${b}`));
    const missingDirectives = TEMPLATE_CONSTRUCTS.directives.filter((d) => !md.includes(d));
    const missingSpecial = TEMPLATE_CONSTRUCTS.special.filter((s) => !new RegExp(`\\b${s}\\b`).test(md));
    const gaps = [
      ...missingBlocks.map((b) => `@${b}`),
      ...missingDirectives,
      ...missingSpecial,
    ];
    if (gaps.length) {
      report(`${skill}: ${gaps.length} template construct(s) the parser accepts are never shown`);
      if (verbose) console.error(`      ${gaps.join(', ')}`);
    } else {
      console.log(`  ✔ ${skill}: shows every block, directive and special attribute the parser accepts`);
    }
  }

  /* ── examples ── */
  for (const [lang, code, line] of codeBlocks(md)) {
    if (lang === 'ts' || lang === 'typescript') {
      const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      // `parseDiagnostics` is not public API but is the only way to see syntax errors here.
      const errs = sf.parseDiagnostics ?? [];
      if (errs.length) {
        report(`${skill}:${line} — a \`ts\` example does not parse: ${ts.flattenDiagnosticMessageText(errs[0].messageText, ' ')}`);
      }
    } else if (lang === 'html') {
      try {
        parseTemplate(code);
      } catch (e) {
        report(`${skill}:${line} — an \`html\` example is not a valid Weave template: ${e.message}`);
      }
    }
  }
}

console.log(`\n${'-'.repeat(60)}`);
if (failures) {
  console.error(
    `skills: ${failures} problem(s)${totalMissing ? `, ${totalMissing} public export(s) undocumented` : ''}\n` +
      `An omitted export is not a gap in prose — it is an agent inventing an API in its place.\n` +
      `Document it, or add it to NOT_TAUGHT with the reason.`
  );
  process.exit(1);
}
console.log('skills: public API covered, every example parses');
