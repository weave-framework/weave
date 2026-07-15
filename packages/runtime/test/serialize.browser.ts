import { test, assert } from '../../../tools/harness.js';
import {
  serialize,
  deserialize,
  registerSerializableType,
  SerializeError,
  type Wire,
} from '@weave-framework/runtime/serialize';

/** serialize → deserialize (in memory). */
const rt = <T>(value: T): unknown => deserialize(serialize(value));
/** serialize → JSON transport → deserialize (proves the wire is JSON-safe). */
const rtJSON = <T>(value: T): unknown => deserialize(JSON.parse(JSON.stringify(serialize(value))) as Wire);

/* ── primitives + typed leaves ── */
test('serialize: primitives round-trip', () => {
  for (const v of ['hi', '', 42, 0, -7, 3.14, true, false, null]) assert.equal(rt(v), v);
  assert.equal(rt(undefined), undefined);
});

test('serialize: non-JSON numbers (NaN / ±Infinity / -0)', () => {
  assert.ok(Number.isNaN(rt(NaN) as number), 'NaN');
  assert.equal(rt(Infinity), Infinity);
  assert.equal(rt(-Infinity), -Infinity);
  assert.ok(Object.is(rt(-0), -0), '-0 preserved (not 0)');
});

test('serialize: BigInt', () => {
  assert.equal(rt(123n), 123n);
  assert.equal(rt(-9007199254740993n), -9007199254740993n);
});

test('serialize: Date + RegExp', () => {
  const d = new Date('2026-07-14T21:19:07.000Z');
  const out = rt(d) as Date;
  assert.ok(out instanceof Date && out.getTime() === d.getTime(), 'Date value + type');
  const re = /ab+c/gi;
  const reOut = rt(re) as RegExp;
  assert.ok(reOut instanceof RegExp && reOut.source === 'ab+c' && reOut.flags === 'gi', 'RegExp source + flags');
});

test('serialize: Map + Set', () => {
  const m = new Map<unknown, unknown>([['a', 1], [2, 'b']]);
  const mOut = rt(m) as Map<unknown, unknown>;
  assert.ok(mOut instanceof Map && mOut.get('a') === 1 && mOut.get(2) === 'b', 'Map entries + type');
  const s = new Set([1, 2, 3]);
  const sOut = rt(s) as Set<number>;
  assert.ok(sOut instanceof Set && sOut.has(1) && sOut.has(3) && sOut.size === 3, 'Set members + type');
});

test('serialize: typed arrays (numeric + bigint)', () => {
  const u8 = new Uint8Array([1, 2, 255]);
  const u8Out = rt(u8) as Uint8Array;
  assert.ok(u8Out instanceof Uint8Array && u8Out.length === 3 && u8Out[2] === 255, 'Uint8Array');
  const f64 = new Float64Array([1.5, -2.25]);
  const f64Out = rt(f64) as Float64Array;
  assert.ok(f64Out instanceof Float64Array && f64Out[0] === 1.5 && f64Out[1] === -2.25, 'Float64Array');
  const big = new BigInt64Array([1n, -5n]);
  const bigOut = rt(big) as BigInt64Array;
  assert.ok(bigOut instanceof BigInt64Array && bigOut[0] === 1n && bigOut[1] === -5n, 'BigInt64Array');
});

/* ── structure ── */
test('serialize: nested objects + arrays', () => {
  const v = { a: 1, b: [2, { c: 'three', d: [true, null] }], e: { f: new Date(0) } };
  assert.deepEqual(rt(v), v);
  assert.deepEqual(rtJSON(v), v, 'also survives a JSON transport');
});

/* ── structural sharing ── */
test('serialize: a value referenced twice is shared (identity preserved)', () => {
  const shared = { id: 7 };
  const v = { x: shared, y: shared };
  const out = rt(v) as { x: object; y: object };
  assert.is(out.x, out.y, 'both fields decode to the SAME object, not two copies');
  const wire: Wire = serialize(v);
  // shared object encoded once → its node appears a single time
  const objNodes = wire.n.filter((n) => n[0] === 'obj').length;
  assert.equal(objNodes, 2, 'only the root + the one shared object are encoded (not duplicated)');
});

/* ── cycles ── */
test('serialize: a self-referential cycle round-trips', () => {
  const v: Record<string, unknown> = { name: 'root' };
  v.self = v;
  const out = rt(v) as Record<string, unknown>;
  assert.equal(out.name, 'root');
  assert.is(out.self, out, 'the cycle points back to the same decoded object');
});

test('serialize: a two-node cycle (a↔b) round-trips', () => {
  const a: Record<string, unknown> = { tag: 'a' };
  const b: Record<string, unknown> = { tag: 'b' };
  a.b = b;
  b.a = a;
  const out = rt(a) as Record<string, unknown>;
  assert.equal((out.b as Record<string, unknown>).tag, 'b');
  assert.is((out.b as Record<string, unknown>).a, out, 'b.a points back to a');
});

/* ── custom class ── */
class Point {
  constructor(public x: number, public y: number) {}
  get sum(): number {
    return this.x + this.y;
  }
}
registerSerializableType({
  tag: 'Point',
  test: (v) => v instanceof Point,
  encode: (p) => ({ x: (p as Point).x, y: (p as Point).y }),
  decode: (d) => new Point((d as { x: number; y: number }).x, (d as { x: number; y: number }).y),
});

test('serialize: custom class via a registered SerializableType', () => {
  const p = new Point(3, 4);
  const out = rt(p) as Point;
  assert.ok(out instanceof Point, 'decoded back to a Point instance (behaviour restored)');
  assert.equal(out.sum, 7, 'the class method works on the decoded instance');
  // nested + shared inside a larger structure
  const container = rt({ points: [p, new Point(1, 1)] }) as { points: Point[] };
  assert.ok(container.points[0] instanceof Point && container.points[0].sum === 7, 'nested custom instance');
});

/* ── the non-serializable guard ── */
test('serialize: a function throws SerializeError (not silent corruption)', () => {
  let threw = false;
  try {
    serialize({ fn: () => 1 });
  } catch (e) {
    threw = e instanceof SerializeError;
  }
  assert.ok(threw, 'serializing a function throws SerializeError');
});

test('serialize: a symbol throws SerializeError', () => {
  let threw = false;
  try {
    serialize(Symbol('x'));
  } catch (e) {
    threw = e instanceof SerializeError;
  }
  assert.ok(threw);
});

test('serialize: an unregistered class instance throws SerializeError', () => {
  class Unknown {
    v = 1;
  }
  let threw = false;
  try {
    serialize(new Unknown());
  } catch (e) {
    threw = e instanceof SerializeError;
  }
  assert.ok(threw, 'a non-plain object with no registered type is rejected');
});

/* ── wire shape ── */
test('serialize: the Wire is JSON-safe + versioned', () => {
  const wire: Wire = serialize({ a: [1, new Date(0), 'x'] });
  assert.equal(wire.v, 1, 'format version');
  assert.equal(typeof wire.r, 'number', 'root is an index');
  assert.ok(Array.isArray(wire.n), 'node table is an array');
  assert.equal(JSON.parse(JSON.stringify(wire)).v, 1, 'stringify → parse is lossless');
});
