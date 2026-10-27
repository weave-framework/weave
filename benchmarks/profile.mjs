/**
 * Where the time goes: a CPU profile of one benchmark operation, aggregated by function.
 *
 * `bench.mjs` says HOW MUCH slower than vanilla an operation is; this says WHICH functions the time is in,
 * so an optimisation is aimed at a measured hot spot rather than at a guess. It drives the same harness
 * (`globalThis.__profile`) under Chromium's sampling profiler (CDP `Profiler`), repeats the operation enough
 * times for the samples to mean something, and prints self time per function — framework, DOM, and the
 * harness's own data building side by side, so the share that is actually Weave's is visible.
 *
 *   node benchmarks/profile.mjs                       # component rows, create 10,000 (the slowest op)
 *   node benchmarks/profile.mjs create10k weave       # bare rows
 *   node benchmarks/profile.mjs clear component 40    # another op, 40 repetitions
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const [opKey = 'create10k', impl = 'component', repsArg = '12'] = process.argv.slice(2);
const reps = Number(repsArg);
const root = fileURLToPath(new URL('..', import.meta.url));

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./harness.js', import.meta.url))],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
  absWorkingDir: root,
  minify: false, // function names are the point
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // µs
await cdp.send('Profiler.start');
const ms = await page.evaluate(([k, i, r]) => globalThis.__profile(k, i, r), [opKey, impl, reps]);
const { profile } = await cdp.send('Profiler.stop');
await browser.close();

// Self time per node, summed by (function, url:line) — then by function name for the headline table.
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const f = n.callFrame;
  const key = `${f.functionName || '(anonymous)'} @ ${f.url.split('/').pop() || '(native)'}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

console.log(`\n${impl} · ${opKey} × ${reps}: ${ms.toFixed(0)} ms of operation time, ${(total / 1000).toFixed(0)} ms sampled\n`);
console.log('self %   self ms  function @ file:line');
console.log('-'.repeat(72));
for (const [k, us] of rows) console.log(`${((us / total) * 100).toFixed(1).padStart(6)}%  ${(us / 1000).toFixed(1).padStart(7)}  ${k}`);
console.log('\n(self time: the function itself, not what it calls; "(program)"/"(garbage collector)" are the VM\'s own)\n');
