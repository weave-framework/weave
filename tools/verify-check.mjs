/**
 * M8 proof: `weave check` type-checks template expressions against
 * `ReturnType<typeof setup>` and reports errors at the ORIGINAL `.weave`
 * line:col.
 *
 *  - A valid component passes (exit 0, "no type errors").
 *  - A component with a ctx typo (`coutn`) and a member typo (`.toFixedd`) fails
 *    (exit 1), each diagnostic pinned to the exact source line it lives on.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`✖ ${msg}`);
    process.exit(1);
  }
  console.log(`✔ ${msg}`);
};

const run = (...paths) =>
  spawnSync(process.execPath, ['packages/cli/bin/weave.mjs', 'check', ...paths], {
    encoding: 'utf8',
  });

/* ── valid components pass (both authoring forms) ── */
{
  const r = run('examples/__fixtures__/check/good.weave', 'examples/__fixtures__/check/widget.ts');
  ok(r.status === 0, `check: valid SFC + separate-file exit 0 (got ${r.status})`);
  ok(/no type errors/.test(r.stdout), 'check: valid components report no type errors');
}

/* ── invalid component fails, with exact positions ── */
{
  const r = run('examples/__fixtures__/check/bad.weave');
  ok(r.status === 1, `check: bad.weave exits 1 (got ${r.status})`);

  const out = r.stdout + r.stderr;
  const src = readFileSync('examples/__fixtures__/check/bad.weave', 'utf8').split('\n');
  const lineOf = (needle) => src.findIndex((l) => l.includes(needle)) + 1; // 1-based

  // ctx typo: `coutn` → "Property 'coutn' does not exist … Did you mean 'count'?"
  const coutnLine = lineOf('coutn');
  const reCoutn = new RegExp(`bad\\.weave:${coutnLine}:(\\d+) - error TS\\d+: .*coutn`);
  const mCoutn = out.match(reCoutn);
  ok(!!mCoutn, `check: ctx typo flagged at bad.weave:${coutnLine} (line match)`);
  if (mCoutn) {
    // column must point at the 'coutn' token, not column 1
    const col = Number(mCoutn[1]);
    const expectedCol = src[coutnLine - 1].indexOf('coutn') + 1;
    ok(col === expectedCol, `check: ctx typo column is exact (${col} === ${expectedCol})`);
  }
  ok(/Did you mean 'count'/.test(out), 'check: suggestion ("Did you mean count") surfaced');

  // member typo: `.toFixedd` on a number
  const fixLine = lineOf('toFixedd');
  const reFix = new RegExp(`bad\\.weave:${fixLine}:\\d+ - error TS\\d+: .*toFixedd`);
  ok(reFix.test(out), `check: member typo flagged at bad.weave:${fixLine}`);

  // use: action arg type mismatch: tooltip expects string, gets count() (number)
  const useLine = lineOf('use:tooltip');
  const reUse = new RegExp(`bad\\.weave:${useLine}:\\d+ - error TS\\d+: .*not assignable`);
  ok(reUse.test(out), `check: use: action arg type error flagged at bad.weave:${useLine}`);

  // @await @then alias typo: u is { name } (Awaited<Promise<…>>), u.naem is invalid
  const awaitLine = lineOf('u.naem');
  const reAwait = new RegExp(`bad\\.weave:${awaitLine}:\\d+ - error TS\\d+: .*naem`);
  ok(reAwait.test(out), `check: @await @then alias type error flagged at bad.weave:${awaitLine}`);

  // @render arity: greet(name) needs 1 arg; greet() passes 0 → TS2554
  const renderLine = lineOf('(greet())');
  const reRender = new RegExp(`bad\\.weave:${renderLine}:\\d+ - error TS\\d+: .*[Aa]rgument`);
  ok(reRender.test(out), `check: @render arity error flagged at bad.weave:${renderLine}`);
}

/* ── separate-file form: template error → .html, script error → .ts ── */
{
  const r = run('examples/__fixtures__/check/sep-bad.ts');
  ok(r.status === 1, `check: sep-bad exits 1 (got ${r.status})`);
  const out = r.stdout + r.stderr;

  const html = readFileSync('examples/__fixtures__/check/sep-bad.html', 'utf8').split('\n');
  const nnLine = html.findIndex((l) => l.includes('nn()')) + 1;
  ok(
    new RegExp(`sep-bad\\.html:${nnLine}:\\d+ - error TS\\d+: .*nn`).test(out),
    `check: template typo mapped to sep-bad.html:${nnLine}`
  );

  const ts = readFileSync('examples/__fixtures__/check/sep-bad.ts', 'utf8').split('\n');
  const badLine = ts.findIndex((l) => l.includes("'not a number'")) + 1;
  ok(
    new RegExp(`sep-bad\\.ts:${badLine}:\\d+ - error TS\\d+:`).test(out),
    `check: script type error mapped to sep-bad.ts:${badLine}`
  );
}

/* ── child-component props: a parent's `<Card …>` is checked against the child's
      `setup` prop contract (resolved through the synthesized default export) ── */
{
  const good = run('examples/__fixtures__/check/card.ts', 'examples/__fixtures__/check/uses-card-good.ts');
  ok(good.status === 0, `check: correct child props pass (exit ${good.status})`);
  ok(/no type errors/.test(good.stdout), 'check: well-typed <Card …> reports no errors');

  const bad = run('examples/__fixtures__/check/card.ts', 'examples/__fixtures__/check/uses-card-bad.ts');
  ok(bad.status === 1, `check: bad child props exit 1 (got ${bad.status})`);
  const out = bad.stdout + bad.stderr;

  const html = readFileSync('examples/__fixtures__/check/uses-card-bad.html', 'utf8').split('\n');
  // `label={{it.count}}` — a number passed to a `string` prop → TS2322, mapped to .html
  const mismatchLine = html.findIndex((l) => l.includes('label={{it.count}}')) + 1;
  ok(
    new RegExp(`uses-card-bad\\.html:${mismatchLine}:\\d+ - error TS2322: .*not assignable`).test(out),
    `check: child prop type mismatch flagged at uses-card-bad.html:${mismatchLine}`
  );
  // `extra={…}` — a prop the child doesn't declare → excess-property TS2353
  const excessLine = html.findIndex((l) => l.includes('extra=')) + 1;
  ok(
    new RegExp(`uses-card-bad\\.html:${excessLine}:\\d+ - error TS2353: .*'extra'`).test(out),
    `check: unknown child prop flagged at uses-card-bad.html:${excessLine}`
  );
}

/* ── the demo app must type-check clean end-to-end: this exercises child-component
      prop checking across a real multi-component tree (board → Card, modal → form, …) ── */
{
  const r = run('examples/demo/src');
  ok(r.status === 0, `check: demo app type-checks clean (exit ${r.status})`);
  if (r.status !== 0) console.error(r.stdout + r.stderr);
}

console.log('\nM8 check (weave check) verified.');
