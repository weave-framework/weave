/**
 * Minimal in-browser test harness. Test files import `test` + `assert`, register
 * cases at module load, and the Playwright runner calls `globalThis.__weaveRun()`.
 * Keeps test-time dependencies to zero (no jsdom, no test framework in the page).
 */

type TestFn = () => void | Promise<void>;
interface Case { name: string; fn: TestFn; }

const cases: Case[] = [];

export function test(name: string, fn: TestFn): void {
  cases.push({ name, fn });
}

function fail(msg: string): never {
  throw new Error(msg);
}

export const assert = {
  equal(actual: unknown, expected: unknown, msg?: string): void {
    if (!Object.is(actual, expected)) {
      fail(msg ?? `expected ${format(expected)}, got ${format(actual)}`);
    }
  },
  notEqual(actual: unknown, expected: unknown, msg?: string): void {
    if (Object.is(actual, expected)) fail(msg ?? `expected values to differ, both ${format(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown, msg?: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) fail(msg ?? `deepEqual failed:\n  actual:   ${a}\n  expected: ${e}`);
  },
  ok(value: unknown, msg?: string): void {
    if (!value) fail(msg ?? `expected truthy, got ${format(value)}`);
  },
  is(actual: unknown, expected: unknown, msg?: string): void {
    if (actual !== expected) fail(msg ?? `expected same reference`);
  },
};

function format(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof Node) return `<${(v as Element).nodeName ?? 'node'}>`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export interface Result {
  name: string;
  ok: boolean;
  error?: string;
}

export async function runAll(): Promise<{ passed: number; failed: number; results: Result[] }> {
  const results: Result[] = [];
  for (const c of cases) {
    try {
      await c.fn();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}

// Exposed for the Playwright runner to invoke after the bundle loads.
(globalThis as unknown as { __weaveRun?: typeof runAll }).__weaveRun = runAll;
