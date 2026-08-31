import { signal, computed, type Signal } from '@weave-framework/runtime';
import { serialize, deserialize, SerializeError } from '@weave-framework/runtime/serialize';

/**
 * What survives the wire, tried on values rather than described in a list.
 *
 * This is the same `serialize` the server render uses to write a page's state snapshot, so "can this
 * resume" is not a rule of thumb here — it is a round-trip you watch succeed or fail. Each case shows
 * what came out the other side, or the exact message it refused with.
 *
 * Cyclic data is included on purpose: people expect it to fail and it does not.
 */
interface Case {
  label: string;
  build: () => unknown;
}

const cycle = (): unknown => {
  const a: Record<string, unknown> = { name: 'a' };
  a.self = a;
  return a;
};

const CASES: Case[] = [
  { label: 'plain data', build: () => ({ id: 7, tags: ['a', 'b'], ok: true }) },
  { label: 'a Date', build: () => new Date('2026-08-31T12:00:00Z') },
  { label: 'a Map', build: () => new Map([['k', 1]]) },
  { label: 'a Set', build: () => new Set([1, 2, 3]) },
  { label: 'undefined and NaN', build: () => ({ u: undefined, n: NaN }) },
  { label: 'an object that points at itself', build: cycle },
  { label: 'a signal object itself', build: () => signal(42) },
  { label: 'a function', build: () => (): number => 1 },
  { label: 'a class instance with methods', build: () => new (class Live { tick(): void {} })() },
  { label: 'a DOM node', build: () => document.createElement('div') },
];

interface Result {
  label: string;
  ok: boolean;
  out: string;
}

/**
 * A short description of a deserialized value that survives a CYCLE.
 *
 * The first version used `JSON.stringify` here, which threw "Converting circular structure to JSON" —
 * and the table then reported the cyclic case as a serialization failure. It was not: `serialize` and
 * `deserialize` had both succeeded, and the display code was the thing that could not cope. Exactly the
 * kind of false negative this demo exists to prevent.
 */
function describe(v: unknown): string {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(v, (_k, val) => {
    if (val === undefined) return '<undefined>';
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '<the same object again>';
      seen.add(val);
    }
    return val;
  });
  return (text ?? String(v)).slice(0, 60);
}

export function setup() {
  const ran: Signal<boolean> = signal(false);

  const results = computed((): Result[] =>
    !ran()
      ? []
      : CASES.map((c) => {
          try {
            const wire = serialize(c.build());
            const back = deserialize(wire);
            const shape =
              back instanceof Map
                ? `Map(${back.size})`
                : back instanceof Set
                  ? `Set(${back.size})`
                  : back instanceof Date
                    ? back.toISOString()
                    : typeof back === 'function'
                      ? 'a function'
                      : describe(back);
            return { label: c.label, ok: true, out: shape ?? String(back) };
          } catch (e) {
            const msg = e instanceof SerializeError ? e.message : String((e as Error).message);
            return { label: c.label, ok: false, out: msg.slice(0, 88) };
          }
        })
  );

  const run = (): void => {
    ran.set(true);
  };
}
