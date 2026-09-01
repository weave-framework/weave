/**
 * verify:size — the "stay tiny" gate.
 *
 * Weave's identity is a small runtime (signal-native, no VDOM). This gate measures the
 * gzipped size of the SHIPPING runtime entries and fails CI if any exceeds its budget, so
 * bloat can never creep in unnoticed — especially as Phase E (resumable/isomorphic signals)
 * adds new capability. The rule: the client SPA core stays flat; new surfaces (SSR resume,
 * local-first sync) get their OWN budget lines and cost 0 bytes for apps that don't import them.
 *
 * Budgets are gzipped bytes of the MINIFIED entry (run `pnpm build:packages` first) — what a
 * consumer's bundler actually ships. Re-baselined 2026-08-29 when the gate was switched from raw
 * `tsc` emit to minified: reactive 1503 · dom 5224 · SPA core 6727 · server 3879. Every budget below
 * is `measured × 1.05`, rounded up to the next 64 bytes — a real regression trips the gate, a minor
 * legit change fits. The per-entry notes further down are the UNMINIFIED history that produced each
 * line; they are kept because they record why it moved, and they no longer cost anything to keep.
 *
 * Add a new line to BUDGETS the first time a new shipping entry lands (e.g. runtime/resume,
 * @weave-framework/sync). Never raise a budget to make a red build pass without a conscious call.
 */
import { gzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

/** Each budget: a label, the dist files it sums (gzipped, together), and the ceiling in bytes. */
const BUDGETS = [
  { label: 'runtime/reactive (signal core)', files: ['packages/runtime/dist/reactive.js'], budget: 1_600 },
  // → 5_632 (+128, a deliberate call): `applyAttr` now says something when a URL that EXECUTES reaches an
  // attribute that navigates — `href={{ url }}` with a `javascript:` value runs on click, and the
  // framework was the only party that knew both which attribute it was and what the value turned out to
  // be. It reports and still sets the attribute. The code is a five-entry tag→attribute map, one regex,
  // and the sentence itself, which is most of the 47 bytes it went over by. A security warning in the
  // renderer is worth 128 bytes; shortening the sentence to fit would have spent the part that helps.
  { label: 'runtime/dom (renderer)', files: ['packages/runtime/dist/dom.js'], budget: 5_632 },
  {
    label: 'SPA core (reactive + dom)',
    files: ['packages/runtime/dist/reactive.js', 'packages/runtime/dist/dom.js'],
    // 22 KB — the number that protects "tiny".
    // → 22_784 (+256, a deliberate call): `flush` gained a re-entrancy guard, without which a write
    // made during a render — `ref={{ el }}` on any component that takes one — drained the queue from
    // inside the effect still running, one stack frame per item, and a long list ended in
    // `RangeError: Maximum call stack size exceeded` with the DOM left half-updated. It is a crash
    // fix in the core; the code is a flag plus a try/finally (the flag cannot be skipped — a throw
    // that escaped would wedge the scheduler permanently). The reactive line stays inside its own
    // budget; this one had 166 bytes of headroom and needed a little more.
    // (An earlier note here said this gate measures the UNMINIFIED dist, so doc comments count against a
    // number no consumer downloads. That has not been true since `gzBytes` gained `minify: true`: every
    // figure below is minified-then-gzipped, and a comment costs nothing.)
    budget: 7_104,
  },
  // Phase E entries — opt-in, NOT part of the SPA core (0 bytes for apps that don't import them).
  // runtime/serialize (E0.1): the wire-format codec, used by SSR-resume + local-first. Baseline 3.1 KB.
  { label: 'runtime/serialize (E0.1 codec)', files: ['packages/runtime/dist/serialize.js'], budget: 1_600 },
  // runtime/resume (E0.2a/b): resumable event dispatch + handler registration. Baseline 2.4 KB; budget
  // 2560 → 3072 (E1.9: with no collecting session a resumable render is a LIVE client render, so it wires a
  // real listener and skips the marker — that is what makes a resumable bundle work under CSR at all: a
  // fallback root, a route swap, a `@for` row added after resume). Resume-only, 0 for a plain SPA (I3).
  // → 3328 (2026-07-19: `once` is now carried across the delegated dispatch. It used to be DROPPED, so
  // `on:click|once` fired on every click in a resumable build and once in an eager one — the same template
  // meaning two different things. Correctness, not a feature, and worth its 70 bytes.)
  { label: 'runtime/resume (E0.2a/b dispatch)', files: ['packages/runtime/dist/resume.js'], budget: 832 },
  // runtime/adopt (E1.2a/c): DOM-adoption primitives. Server+client, own line — 0 bytes for a plain SPA (I3).
  // Grown across E1.2c (block adopt lands incrementally): E1.2a marker text-bind → E1.2c-1 block-boundary
  // cursor (blockStart/blockEndOf/clearBlock) → E1.2c-2 adoptIsland (@if/@switch island-replay). Budget
  // 1536 → 2560 → 3072 → 3584 (deliberate, forward-looking so each adopt slice doesn't trip a micro-bump;
  // E1.2c-6 added adoptComponent for nested component resume) → 4096 (E1.8 collectInstances: an adopted child
  // registers its root + handler factory so its OWN events resume). The SPA core (20.9 KB) is untouched; this
  // entry never ships to a plain client SPA. → 4608 (E1.12 self-adopting components + E1.13 re-attaching a
  // parent's component-level `on:` handlers, which defineComponent only forwards on the CREATE path).
  // → 4864 (2026-07-19: a server/client mismatch used to repair the DOM in SILENCE. The repair stays — it
  // must not blank a page over one binding — but it now warns once, because a mismatch means the adopt walk
  // disagreed with the server's DOM, and that is this subsystem's best-hidden failure. Note these entries
  // are plain `tsc` output: comments ship, so the "why" costs budget here. That is a deliberate trade.)
  // → 5248 (2026-07-24, Stage A: adopt navigation moved from compile-time absolute-index math (`child(_r,…)` +
  // dynamic-text shifts + post-block `after()`/override) into a runtime `AdoptCursor` — a deliberate robustness
  // refactor that consolidates all navigation into ONE sequential walk (STAGE-A-PLAN.md). The dead `after` +
  // `adoptIsland` helpers were removed, which clawed most of it back; the net is the cursor class shipping once.
  // A one-time step accepted knowingly, not a trend — headroom is deliberately tight so the next change budgets.)
  { label: 'runtime/adopt (E1.2a/c DOM adopt)', files: ['packages/runtime/dist/adopt.js'], budget: 1_344 },
  // runtime/graph (E0.3/E1.2): resume entry — signal codec + snapshot/resume + resumePage (SSG client entry).
  // Budget raised 2048 → 2560 (E1.2 resumePage + SNAPSHOT_ID) → 3072 (E1.2c-6 per-instance state collection:
  // collectStates / registerState / ROOT_ID) → 3584 (E1.2c-6 resume states-map handling + ResumeApp.states)
  // → 4096 (E1.6 derive/DeriveFn — computeds rebuilt on resume; E1.8 ancestry-scoped event resolution, so a
  // child component's own handlers resolve against ITS ctx). Resumable-only, 0 for a plain SPA (I3; SPA core
  // 20.9 KB flat) → 4608 (E1.9 graceful degradation: registerState probes each binding and drops an instance
  // that cannot be serialized — a router/store/class instance — instead of FAILING THE BUILD; plus the
  // resumePage CSR `fallback` and the DroppedState diagnostics the build reports).
  // → 5120 (E1.9b `finalizeStates`: re-probe every instance AFTER the render, since a signal can be reassigned
  // between registerState and the snapshot — without it the docs build died inside `snapshot()` naming nothing).
  // Deliberate: E1.5–E1.12 turned resume from "flat text only" into real components + routed pages.
  { label: 'runtime/graph (E0.3/E1.2 resume)', files: ['packages/runtime/dist/graph.js'], budget: 1_280 },
  // runtime/server (E0.4): headless render — the in-house server DOM + parser + serializer + renderToString.
  // Server-only, its own line — 0 bytes for a client SPA (I3). Baseline 5.8 KB; budget raised 7168 → 7680
  // (E1.3d SSG document-<title> capture) → 8192 (E1.4 the islands capture: `renderPage({ resumable })` wraps
  // the render in `collectStates` + tags the root `$root` + snapshots the per-instance state map, pulling in
  // collectStates/ROOT_ID). Deliberate — the SPA core (20.9 KB) is untouched; this line never ships to a browser.
  // → 9728 (E1.3 async render): `renderPage` is now async and settles every tracked fetch BEFORE serializing,
  // so a page with a `resource()` prerenders WITH its data instead of shipping `loading: true` and making the
  // client refetch what the build just fetched. Costs the async/await transform + the drain loop + splitting
  // build-node/serialize apart so the owner outlives the wait (8.1 → 8.9 KB). Trimmed the prose first — that
  // was 0.3 KB of it, since dist is unminified. Same rationale as every bump on this line: server-only.
  {
    label: 'runtime/server (E0.4 headless)',
    files: ['packages/runtime/dist/server.js', 'packages/runtime/dist/server-dom.js', 'packages/runtime/dist/document.js'],
    // 8192 → 8704 (E1.9: renderPage declares the server render via collectResumable + maps dropped instances
    // to build warnings) → 9472 (E1.3 async render; see the note above — measured 8.9, ~6% headroom, the
    // margin this file runs). Server-only — never ships to a browser.
    // → 9600 (2026-07-19: renderDocument escaped nothing it interpolated. A page title is routinely derived
    // from data — a route-title effect reading a CMS record — so a title carrying a closing title tag plus a
    // script was a STORED XSS baked into every statically generated page. Two escapers + the calls; the prose
    // was trimmed first, recovering 335 of the 376 bytes. The remaining 41 are not worth deleting the "why"
    // over, and this entry never reaches a browser.)
    budget: 4_096,
  },
];

/**
 * Gzipped bytes of the MINIFIED entry — what a consumer's bundler actually ships.
 *
 * This used to gzip the raw `dist` output, which is plain `tsc` emit: every doc comment counted
 * against a budget no browser ever downloads. Measured 2026-08-29, that was 70% of the number
 * (the SPA core read 22.1 KB; the truth is 6.6 KB), with two consequences — the headroom shown was
 * fiction, so a core change hit a wall that was not there, and explaining WHY a line moved cost
 * budget, which is exactly backwards. Comments are free now; spend them.
 *
 * Each entry is minified on its own and the gzip sizes summed, matching how the budgets are
 * declared (per file, summed). Not byte-identical to bundling them together, but a consistent
 * measure — and consistency is what a regression gate needs.
 */
function gzBytes(relFiles) {
  let total = 0;
  for (const rel of relFiles) {
    const abs = join(repo, rel);
    if (!existsSync(abs)) return { missing: rel, total: 0 };
    const min = transformSync(readFileSync(abs, 'utf8'), { loader: 'js', format: 'esm', minify: true }).code;
    total += gzipSync(min).length;
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
