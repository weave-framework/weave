/**
 * A snapshot must not be able to choose an object's prototype.
 *
 * `deserialize` rebuilt a plain object with `obj[key] = value`, and `__proto__` is not an ordinary key:
 * assigning it REPLACES the object's prototype. A wire graph carrying that key therefore handed the
 * sender control of every property the app had not set itself — and invisibly, which is the part that
 * matters:
 *
 *     JSON.stringify(state)      →  {"user":{"name":"mallory"}}    // looks ordinary
 *     Object.keys(state.user)    →  ['name']                       // nothing to see
 *     state.user.isAdmin         →  true                           // nobody serialized this
 *
 * A guard written as `if (state.user.isAdmin)` passes, and no logging of the state would ever show
 * why. `serialize`/`deserialize` are public API, so an application that stores or transmits state —
 * localStorage, a URL, a saved session — feeds this path directly from whatever it was given.
 *
 * The fix keeps the DATA: the key becomes a real own property via `defineProperty`, so a round trip is
 * unchanged and the prototype is untouched. Refusing outright would have been the other defensible
 * answer; preserving what was sent, without letting it choose a prototype, is the narrower one.
 *
 * Run: `node packages/runtime/test/deserialize-proto.smoke.mjs` (wired into `pnpm verify:deserialize-proto`).
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/runtime/test/deserialize-proto.smoke.mjs');

const bundle = join(repo, 'tools', '.verify-deserialize-proto-bundle.mjs');
await build({
  entryPoints: [join(repo, 'packages/runtime/src/serialize.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  external: ['esbuild', 'typescript', 'sass'],
});
const { serialize, deserialize } = await import(pathToFileURL(bundle).href);

/* ── 1. The attack, as an application would receive it ── */
// Built through JSON.parse so `__proto__` is a genuine own key of the node map, which is what a
// hand-crafted payload looks like on the wire. An object literal would set a prototype here instead.
const attack = JSON.parse(
  '{"v":1,"r":0,"n":[["obj",{"user":1}],["obj",{"__proto__":2,"name":3}],' +
    '["p",{"isAdmin":true,"role":"admin"}],["p","mallory"]]}'
);
const state = deserialize(attack);

ok(state.user.name === 'mallory', 'the honest data still arrives');
ok(state.user.isAdmin === undefined, `a property nobody serialized stays undefined (got ${String(state.user.isAdmin)})`);
ok(state.user.role === undefined, `and so does the second one (got ${String(state.user.role)})`);
ok(
  Object.getPrototypeOf(state.user) === Object.prototype,
  'the object keeps its own prototype — the sender does not choose it'
);
ok(({}).isAdmin === undefined, 'and nothing leaked onto Object.prototype');

/* ── 2. The data is not thrown away either ── */
ok(
  Object.prototype.hasOwnProperty.call(state.user, '__proto__'),
  'the sent key survives as an ordinary own property, so a round trip loses nothing'
);

/* ── 3. The ordinary path is untouched, or this is just a way to break deserialization ── */
const round = deserialize(serialize({ a: 1, nested: { b: [1, 2, { c: 'three' }] } }));
ok(
  JSON.stringify(round) === JSON.stringify({ a: 1, nested: { b: [1, 2, { c: 'three' }] } }),
  `a normal graph round-trips unchanged (got ${JSON.stringify(round)})`
);
ok(Object.getPrototypeOf(round.nested) === Object.prototype, 'and its objects are ordinary objects');

rmSync(bundle, { force: true });

console.log('\n----------------------------------------');
if (failed) {
  console.error(`deserialize-proto smoke FAILED (${failed})\n`);
  process.exit(1);
}
console.log('deserialize-proto smoke passed\n');
