/**
 * `@weave-framework/runtime/serialize` — the Phase E (E0.1) wire format.
 *
 * A compact, zero-dependency, in-house codec for arbitrary JavaScript values, built to snapshot a
 * reactive graph across a boundary (server → client for resume, or disk/sync for local-first). It is
 * NOT imported by a plain client SPA — it is a separate entry, tree-shaken away unless you use SSR /
 * resume / sync (invariant I3: 0 bytes for SPA-only apps).
 *
 * Beyond `JSON`, it handles what a real app graph contains:
 * - **Structural sharing** — a value that appears many times is encoded once and referenced by index.
 * - **Cycles** — the graph may reference itself; the codec reserves an index before recursing, and
 *   decode resolves references lazily, so a cycle rebuilds correctly.
 * - **Typed leaves** — `undefined`, `NaN` / `±Infinity` / `-0`, `BigInt`, `Date`, `RegExp`, `Map`,
 *   `Set`, and the numeric + bigint `TypedArray`s survive a round-trip (plain `JSON` loses them).
 * - **Custom classes** — register a {@link SerializableType} to (de)serialize your own class.
 * - **A non-serializable guard** — a value that cannot cross the boundary (a function, a symbol, a live
 *   class instance with no registered type) throws {@link SerializeError} instead of silently corrupting.
 *
 * The {@link Wire} is itself JSON-safe, so `JSON.stringify(serialize(x))` is a valid transport string.
 *
 *   import { serialize, deserialize } from '@weave-framework/runtime/serialize';
 *   const wire = serialize(graph);          // server / build
 *   const graph = deserialize(wire);        // client — same value, structure, cycles, and types
 */

/** A registered (de)serializer for a custom class the plain codec can't handle. */
export interface SerializableType<T = unknown> {
  /** A short, stable tag stored in the wire (must be unique + identical on both sides). */
  tag: string;
  /** True when this handler owns `value` (e.g. `value instanceof MyClass`). */
  test: (value: unknown) => boolean;
  /** Reduce the instance to plain, serializable data (encoded recursively). */
  encode: (value: T) => unknown;
  /** Rebuild the instance from the decoded data. */
  decode: (data: unknown) => T;
}

export interface SerializeOptions {
  /** Extra custom types for this call, consulted before the global registry. */
  types?: SerializableType[];
}

/** A JSON-safe snapshot: a format version, the root node index, and the flat node table. */
export interface Wire {
  /** Format version (bumped on any breaking change to the encoding). */
  v: 1;
  /** Index into `n` of the root value. */
  r: number;
  /** The flat node table — every value is one node; references between them are indices. */
  n: WireNode[];
}

/** One encoded value. A tagged tuple; integers inside container payloads are node indices. */
type WireNode =
  | ['p', string | number | boolean | null] // inlined primitive
  | ['u'] // undefined
  | ['nan'] | ['inf'] | ['-inf'] | ['-0'] // non-JSON numbers
  | ['big', string] // BigInt
  | ['date', number] // Date (epoch ms; NaN date → 'date' with null handled below)
  | ['re', string, string] // RegExp source + flags
  | ['arr', number[]] // array of refs
  | ['obj', Record<string, number>] // plain object: key → ref
  | ['map', [number, number][]] // Map: [keyRef, valRef][]
  | ['set', number[]] // Set of refs
  | ['ta', string, (number | string)[]] // typed array: ctor name + values (bigints as strings)
  | ['cls', string, number]; // custom type: tag + dataRef

/** Thrown when a value cannot be represented in the wire format. */
export class SerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerializeError';
  }
}

const globalTypes: SerializableType[] = [];

/** Register a custom (de)serializer globally (available to every `serialize`/`deserialize`). */
export function registerSerializableType(type: SerializableType): void {
  globalTypes.push(type);
}

const TYPED_ARRAYS: Record<string, new (length: number) => { [i: number]: unknown; length: number }> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array: BigInt64Array as unknown as new (length: number) => { [i: number]: unknown; length: number },
  BigUint64Array: BigUint64Array as unknown as new (length: number) => { [i: number]: unknown; length: number },
};

const typedArrayName = (value: object): string | null => {
  const name: string = Object.prototype.toString.call(value).slice(8, -1);
  return name in TYPED_ARRAYS ? name : null;
};

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Encode any value to a {@link Wire}. Throws {@link SerializeError} on a non-serializable value. */
export function serialize(value: unknown, options?: SerializeOptions): Wire {
  const types: SerializableType[] = options?.types ? [...options.types, ...globalTypes] : globalTypes;
  const nodes: WireNode[] = [];
  const seen = new Map<unknown, number>();

  // Reference types (+ strings) are shared; primitives are cheap and never cause cycles, so they get a
  // fresh node each time (simpler, and sharing them buys little).
  const shareable = (v: unknown): boolean => (typeof v === 'object' && v !== null) || typeof v === 'string';

  const ref = (v: unknown): number => {
    if (shareable(v) && seen.has(v)) return seen.get(v) as number;
    const index: number = nodes.length;
    nodes.push(['u']); // placeholder reserved BEFORE recursing, so a cycle resolves back to `index`
    if (shareable(v)) seen.set(v, index);
    nodes[index] = encode(v);
    return index;
  };

  const encode = (v: unknown): WireNode => {
    if (v === undefined) return ['u'];
    if (v === null) return ['p', null];
    const t: string = typeof v;
    if (t === 'boolean') return ['p', v as boolean];
    if (t === 'string') return ['p', v as string];
    if (t === 'number') {
      const n: number = v as number;
      if (Number.isNaN(n)) return ['nan'];
      if (n === Infinity) return ['inf'];
      if (n === -Infinity) return ['-inf'];
      if (Object.is(n, -0)) return ['-0'];
      return ['p', n];
    }
    if (t === 'bigint') return ['big', (v as bigint).toString()];
    // Custom types are consulted FIRST for any non-primitive — so a registered {@link SerializableType}
    // can claim even a FUNCTION (e.g. a Weave signal, encoded as its value; see runtime/graph). Only an
    // UNCLAIMED function/symbol is non-serializable.
    if (t === 'function' || t === 'object') {
      for (const type of types) {
        if (type.test(v)) return ['cls', type.tag, ref(type.encode(v))];
      }
    }
    if (t === 'function' || t === 'symbol') {
      throw new SerializeError(`Cannot serialize a ${t}${t === 'function' ? ' (register a SerializableType, or use a resumable handler ref)' : ''}.`);
    }
    // objects (null handled above; custom types already tried)
    const obj: object = v as object;
    if (obj instanceof Date) return ['date', obj.getTime()];
    if (obj instanceof RegExp) return ['re', obj.source, obj.flags];
    if (Array.isArray(obj)) return ['arr', obj.map((el) => ref(el))];
    if (obj instanceof Map) return ['map', [...obj.entries()].map(([k, val]) => [ref(k), ref(val)] as [number, number])];
    if (obj instanceof Set) return ['set', [...obj].map((el) => ref(el))];
    const ta: string | null = typedArrayName(obj);
    if (ta) {
      const arr: ArrayLike<number | bigint> = obj as ArrayLike<number | bigint>;
      const out: (number | string)[] = [];
      for (let i = 0; i < arr.length; i++) {
        const el: number | bigint = arr[i];
        out.push(typeof el === 'bigint' ? el.toString() : el);
      }
      return ['ta', ta, out];
    }
    if (isPlainObject(obj)) {
      const map: Record<string, number> = {};
      for (const key of Object.keys(obj)) map[key] = ref((obj as Record<string, unknown>)[key]);
      return ['obj', map];
    }
    throw new SerializeError(`Cannot serialize a non-plain object (${obj.constructor?.name ?? 'unknown'}) — register a SerializableType for it.`);
  };

  const rootRef: number = ref(value);
  return { v: 1, r: rootRef, n: nodes };
}

/** Decode a {@link Wire} back to the original value (structure, cycles, and types restored). */
export function deserialize(wire: Wire, options?: SerializeOptions): unknown {
  if (!wire || wire.v !== 1 || !Array.isArray(wire.n)) throw new SerializeError('Not a valid Wire (version 1) object.');
  const types: SerializableType[] = options?.types ? [...options.types, ...globalTypes] : globalTypes;
  const byTag = new Map<string, SerializableType>();
  for (const type of types) if (!byTag.has(type.tag)) byTag.set(type.tag, type);

  const nodes: WireNode[] = wire.n;
  const built: unknown[] = new Array(nodes.length);
  const done: boolean[] = new Array(nodes.length).fill(false);

  // Memoized resolve: create a container shell + mark it done BEFORE filling, so a cycle back to the
  // same node resolves to the (still-being-filled) shell rather than looping forever.
  const resolve = (i: number): unknown => {
    if (done[i]) return built[i];
    const node: WireNode = nodes[i];
    const tag: string = node[0];
    switch (tag) {
      case 'p':
        built[i] = node[1];
        break;
      case 'u':
        built[i] = undefined;
        break;
      case 'nan':
        built[i] = NaN;
        break;
      case 'inf':
        built[i] = Infinity;
        break;
      case '-inf':
        built[i] = -Infinity;
        break;
      case '-0':
        built[i] = -0;
        break;
      case 'big':
        built[i] = BigInt(node[1] as string);
        break;
      case 'date':
        built[i] = new Date(node[1] as number);
        break;
      case 're':
        built[i] = new RegExp(node[1] as string, node[2] as string);
        break;
      case 'arr': {
        const arr: unknown[] = [];
        built[i] = arr;
        done[i] = true;
        for (const r of node[1] as number[]) arr.push(resolve(r));
        return arr;
      }
      case 'obj': {
        const obj: Record<string, unknown> = {};
        built[i] = obj;
        done[i] = true;
        const map: Record<string, number> = node[1] as Record<string, number>;
        for (const key of Object.keys(map)) obj[key] = resolve(map[key]);
        return obj;
      }
      case 'map': {
        const m = new Map<unknown, unknown>();
        built[i] = m;
        done[i] = true;
        for (const [kr, vr] of node[1] as [number, number][]) m.set(resolve(kr), resolve(vr));
        return m;
      }
      case 'set': {
        const s = new Set<unknown>();
        built[i] = s;
        done[i] = true;
        for (const r of node[1] as number[]) s.add(resolve(r));
        return s;
      }
      case 'ta': {
        const ctorName: string = node[1] as string;
        const Ctor = TYPED_ARRAYS[ctorName];
        if (!Ctor) throw new SerializeError(`Unknown typed array in wire: ${ctorName}.`);
        const values: (number | string)[] = node[2] as (number | string)[];
        const isBig: boolean = ctorName.startsWith('Big');
        const out = new Ctor(values.length) as unknown as { [k: number]: unknown };
        built[i] = out;
        done[i] = true;
        for (let k = 0; k < values.length; k++) out[k] = isBig ? BigInt(values[k] as string) : (values[k] as number);
        return out;
      }
      case 'cls': {
        const typeTag: string = node[1] as string;
        const type: SerializableType | undefined = byTag.get(typeTag);
        if (!type) throw new SerializeError(`No SerializableType registered for tag "${typeTag}".`);
        // Custom-class data is resolved first; a cycle THROUGH a custom instance is unsupported (E0.1).
        built[i] = type.decode(resolve(node[2] as number));
        break;
      }
      default:
        throw new SerializeError(`Unknown wire node tag: ${String(tag)}.`);
    }
    done[i] = true;
    return built[i];
  };

  return resolve(wire.r);
}
