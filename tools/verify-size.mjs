/**
 * verify:size — the "stay tiny" gate.
 *
 * Weave's identity is a small runtime (signal-native, no VDOM). This gate measures the
 * gzipped size of the SHIPPING runtime entries and fails CI if any exceeds its budget, so
 * bloat can never creep in unnoticed — especially as Phase E (resumable/isomorphic signals)
 * adds new capability. The rule: the client SPA core stays flat; new surfaces (SSR resume,
 * local-first sync) get their OWN budget lines and cost 0 bytes for apps that don't import them.
 *
 * Budgets are gzipped bytes, measured against the built dist (run `pnpm build:packages` first).
 * Baseline captured 2026-07-14: reactive 4382 · dom 17048 · SPA core 21430 (20.9 KB).
 * Headroom is deliberate but small — a real regression trips the gate; a minor legit change fits.
 *
 * Add a new line to BUDGETS the first time a new shipping entry lands (e.g. runtime/resume,
 * @weave-framework/sync). Never raise a budget to make a red build pass without a conscious call.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** Each budget: a label, the dist files it sums (gzipped, together), and the ceiling in bytes. */
const BUDGETS = [
  { label: 'runtime/reactive (signal core)', files: ['packages/runtime/dist/reactive.js'], budget: 5_120 },
  { label: 'runtime/dom (renderer)', files: ['packages/runtime/dist/dom.js'], budget: 18_432 },
  {
    label: 'SPA core (reactive + dom)',
    files: ['packages/runtime/dist/reactive.js', 'packages/runtime/dist/dom.js'],
    budget: 22_528, // 22 KB — the number that protects "tiny"
  },
  // Phase E entries — opt-in, NOT part of the SPA core (0 bytes for apps that don't import them).
  // runtime/serialize (E0.1): the wire-format codec, used by SSR-resume + local-first. Baseline 3.1 KB.
  { label: 'runtime/serialize (E0.1 codec)', files: ['packages/runtime/dist/serialize.js'], budget: 4_096 },
  // runtime/resume (E0.2a/b): resumable event dispatch + handler registration. Baseline 2.4 KB.
  { label: 'runtime/resume (E0.2a/b dispatch)', files: ['packages/runtime/dist/resume.js'], budget: 2_560 },
  // runtime/adopt (E1.2a): DOM-adoption primitives (marker text bind + adopt). Server+client, own line. Baseline <1 KB.
  { label: 'runtime/adopt (E1.2a DOM adopt)', files: ['packages/runtime/dist/adopt.js'], budget: 1_536 },
  // runtime/graph (E0.3/E1.2): resume entry — signal codec + snapshot/resume + resumePage (SSG client entry).
  // Budget raised 2048 → 2560 (deliberate) when E1.2 added resumePage + SNAPSHOT_ID; still a lean resume entry.
  { label: 'runtime/graph (E0.3/E1.2 resume)', files: ['packages/runtime/dist/graph.js'], budget: 2_560 },
  // runtime/server (E0.4): headless render — the in-house server DOM + parser + serializer + renderToString.
  // Server-only, its own line — 0 bytes for a client SPA (I3). Baseline 5.8 KB; budget raised 7168 → 7680
  // (deliberate) when E1.3d added the SSG document-<title> capture (settable server `document.title` +
  // renderPage read-back). The SPA core (20.9 KB) is untouched — this line never ships to a browser.
  {
    label: 'runtime/server (E0.4 headless)',
    files: ['packages/runtime/dist/server.js', 'packages/runtime/dist/server-dom.js', 'packages/runtime/dist/document.js'],
    budget: 7_680,
  },
];

function gzBytes(relFiles) {
  let total = 0;
  for (const rel of relFiles) {
    const abs = join(repo, rel);
    if (!existsSync(abs)) return { missing: rel, total: 0 };
    total += gzipSync(readFileSync(abs)).length;
  }
  return { missing: null, total };
}

const distProbe = join(repo, 'packages/runtime/dist/reactive.js');
if (!existsSync(distProbe) || !statSync(distProbe).isFile()) {
  console.error('✖ packages/runtime/dist not found — run `pnpm build:packages` first.');
  process.exit(1);
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
let failed = 0;
console.log('verify:size — gzipped shipping budgets\n');
console.log('  entry                              current    budget   headroom  status');
console.log('  ' + '─'.repeat(72));
for (const { label, files, budget } of BUDGETS) {
  const { missing, total } = gzBytes(files);
  if (missing) {
    console.log(`  ✖ ${label.padEnd(32)} MISSING (${missing})`);
    failed++;
    continue;
  }
  const over = total > budget;
  const head = budget - total;
  const status = over ? `✖ OVER by ${head < 0 ? -head : 0}` : '✓';
  console.log(
    `  ${over ? '✖' : '✓'} ${label.padEnd(32)} ${kb(total).padStart(8)} ${kb(budget).padStart(9)} ${((head / 1024).toFixed(1) + ' KB').padStart(9)}  ${status}`
  );
  if (over) failed++;
}
console.log('');
if (failed) {
  console.error(`✖ ${failed} budget(s) exceeded. The runtime must stay tiny — reduce size or make a deliberate budget decision.`);
  process.exit(1);
}
console.log('✓ all size budgets within limits.');
