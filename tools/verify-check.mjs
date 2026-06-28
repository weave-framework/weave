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
  const r = run('examples/check/good.weave', 'examples/check/widget.ts');
  ok(r.status === 0, `check: valid SFC + separate-file exit 0 (got ${r.status})`);
  ok(/no type errors/.test(r.stdout), 'check: valid components report no type errors');
}

/* ── invalid component fails, with exact positions ── */
{
  const r = run('examples/check/bad.weave');
  ok(r.status === 1, `check: bad.weave exits 1 (got ${r.status})`);

  const out = r.stdout + r.stderr;
  const src = readFileSync('examples/check/bad.weave', 'utf8').split('\n');
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
}

/* ── separate-file form: template error → .html, script error → .ts ── */
{
  const r = run('examples/check/sep-bad.ts');
  ok(r.status === 1, `check: sep-bad exits 1 (got ${r.status})`);
  const out = r.stdout + r.stderr;

  const html = readFileSync('examples/check/sep-bad.html', 'utf8').split('\n');
  const nnLine = html.findIndex((l) => l.includes('nn()')) + 1;
  ok(
    new RegExp(`sep-bad\\.html:${nnLine}:\\d+ - error TS\\d+: .*nn`).test(out),
    `check: template typo mapped to sep-bad.html:${nnLine}`
  );

  const ts = readFileSync('examples/check/sep-bad.ts', 'utf8').split('\n');
  const badLine = ts.findIndex((l) => l.includes("'not a number'")) + 1;
  ok(
    new RegExp(`sep-bad\\.ts:${badLine}:\\d+ - error TS\\d+:`).test(out),
    `check: script type error mapped to sep-bad.ts:${badLine}`
  );
}

console.log('\nM8 check (weave check) verified.');
