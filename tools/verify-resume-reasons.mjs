/**
 * Every reason a component can REFUSE to resume is named on the page that teaches resume.
 *
 * A refusal is not a failure — the component client-renders instead and the page works. But it silently
 * throws away the thing an `--ssg` build is for, and the author only learns of it from a build warning
 * naming a construct. If the docs do not name that construct, the warning has nowhere to lead.
 *
 * Measured before this gate existed: the compiler can refuse for ELEVEN distinct reasons; the Static
 * generation page named THREE. Four of the seven real refusals across 622 components on this machine —
 * both `bind:` bindings, a `fly`, a `fade` — were caused by constructs the page never mentioned once.
 *
 * The gate is two-sided on purpose, because a one-sided one rots in whichever direction it does not look:
 *
 *   COMPILER → each reason below must still exist in the compiler. Delete a refusal and its doc entry
 *              becomes a lie about a limit that is gone; this catches that.
 *   COUNT    → the number of literal `cannotAdopt(…)` call sites must equal the number of reasons known
 *              here. ADD a refusal and the gate fails until it is documented. Without this, the docs
 *              would be complete only on the day this file was written.
 *   DOCS     → each reason must be named on the page, by the construct an author would search for.
 *
 * Read-only. Run: `node tools/verify-resume-reasons.mjs`
 */
import { readFileSync } from 'node:fs';

const CODEGEN = 'packages/compiler/src/codegen.ts';
const COMPONENT = 'packages/compiler/src/component.ts';
const PAGE = 'docs/src/content/learn/static-generation.md';

/**
 * One entry per way a component can refuse.
 *
 * `compiler` is matched against the refusal's own source line, `docs` against the page. The docs pattern
 * asks for the CONSTRUCT, not for prose about it: an author reading `uses a \`bind:value\` two-way
 * binding` in a terminal searches the page for `bind:`, and finding a paragraph that says "some bindings
 * cannot be adopted" would not answer them.
 */
const REASONS = [
  // The compiler patterns deliberately do NOT spell the escaped backticks these template literals carry.
  // The first version did, and six of eleven reported "no longer in the compiler" against a compiler that
  // had not changed — a gate wrong about its own subject fails in the direction that looks like news.
  { id: 'use-element',   compiler: /cannotAdopt\(.{0,24}use:\$\{attr\.name\}.{0,12}action/,           docs: /`use:/ },
  { id: 'use-component', compiler: /cannotAdopt\(.{0,24}use:\$\{u\.name\}.{0,16}action on/,           docs: /use:.*<Component/ },
  { id: 'bind',          compiler: /cannotAdopt\(.{0,30}bind:\$\{attr\.name\}.{0,12}two-way binding/, docs: /`bind:/ },
  { id: 'transition',    compiler: /cannotAdopt\(.{0,24}\$\{attr\.name\}.{0,10}transition/,           docs: /`transition:|`fade`|`fly`/ },
  { id: 'interp',        compiler: /cannotAdopt\(.{0,12}a NON-reactive interpolation/,                docs: /non-reactive interpolation/i },
  { id: 'modifiers',     compiler: /cannotAdopt\(\s*.{0,12}on:\$\{attr\.name\}\|/,                    docs: /\|capture/ },
  { id: 'defer',         compiler: /cannotAdopt\('an `@defer` block'\)/,                              docs: /@defer/ },
  { id: 'await',         compiler: /cannotAdopt\('an `@await` block'\)/,                              docs: /@await/ },
  { id: 'dyn-element',   compiler: /cannotAdopt\('a dynamic `<w:element this=/,                       docs: /w:element/ },
  { id: 'in-place',      compiler: /cannotAdopt\(.{0,24}describe\(node\).{0,12}in a position resume cannot adopt/, docs: /in a position resume cannot adopt/ },
  // The one refusal that does not come from the template: `setup()` registered an effect reading a value
  // nothing on the client can rebuild. It is handed to the codegen from outside, via `options.cannotAdopt`.
  { id: 'effect',        compiler: /an .{0,4}effect\(\).{0,6}onMount\(\).{0,4} in setup\(\) that reads/, docs: /`effect\(\)`.{0,12}`onMount\(\)`/ },
];



const codegen = readFileSync(CODEGEN, 'utf8');
const component = readFileSync(COMPONENT, 'utf8');
const source = codegen + '\n' + component;
const page = readFileSync(PAGE, 'utf8');

const problems = [];

for (const r of REASONS) {
  if (!r.compiler.test(source)) problems.push(`${r.id}: this reason is no longer in the compiler — the page may now document a limit that is gone`);
  if (!r.docs.test(page)) problems.push(`${r.id}: the compiler can refuse for this, and ${PAGE} never names it`);
}

// A literal-argument call site is a REASON. `gen.cannotAdopt(options.cannotAdopt)` passes one through from
// outside and is plumbing, not a reason — it takes an identifier, so it is not counted here.
const sites = [...codegen.matchAll(/\bcannotAdopt\(\s*(`|')/g)].length;
const expected = REASONS.filter((r) => r.id !== 'effect').length;
if (sites !== expected)
  problems.push(
    `${CODEGEN} has ${sites} refusal(s) with a literal reason; this gate knows ${expected}. ` +
      `A new way to refuse resume needs an entry here AND a line on ${PAGE}.`
  );

if (problems.length) {
  console.error(`\n✖ resume refusals and the page that teaches them disagree (${problems.length}):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ all ${REASONS.length} resume refusals exist in the compiler and are named on ${PAGE}`);
