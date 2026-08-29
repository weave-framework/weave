/**
 * Named app states — save one, reach it again in a second.
 *
 * Getting a screen into the state you need to look at (no rows, ten thousand rows, the request
 * failed, the document already sent) normally means driving the app there by hand, every time, or
 * standing up fake data to do it for you. Weave state is a graph of named signals that is not fused
 * to the DOM, so a state can simply be captured and set back.
 *
 * Nothing is predicted and nothing is inferred: a state is exactly the values of the signals the
 * author NAMED, captured from a real run. Dev-only — the panel and `weave dev --state` are the only
 * callers, and none of this is reachable from a production build.
 *
 * The wire is the framework's own {@link serialize} format, so a `Date`, a `Map` or a `Set` in a
 * signal survives the round trip through a file instead of decaying into a string.
 */

import { applyState, captureState } from './devtools.js';
import { deserialize, serialize, type Wire } from './serialize.js';

/** Where saved states live, as served by `weave dev`. */
const ENDPOINT: string = '/__weave_state';

/** Reading and writing named states. The dev server implements it; the panel talks to it. */
export interface StatesAdapter {
  /** The names that have been saved. */
  list: () => Promise<string[]>;
  /** Read one back and apply it. Resolves to how many named signals it actually set. */
  apply: (name: string) => Promise<number>;
  /** Capture the app as it stands right now and save it under `name`. */
  save: (name: string) => Promise<void>;
}

/** The adapter backed by `weave dev`'s own endpoints. */
export function devServerStates(): StatesAdapter {
  const url = (name?: string): string => (name ? `${ENDPOINT}/${encodeURIComponent(name)}` : ENDPOINT);
  return {
    list: async (): Promise<string[]> => {
      const res: Response = await fetch(url());
      if (!res.ok) return [];
      return (await res.json()) as string[];
    },
    apply: async (name: string): Promise<number> => {
      const res: Response = await fetch(url(name));
      if (!res.ok) throw new Error(`no saved state named ${name}`);
      return applyState(deserialize((await res.json()) as Wire) as Record<string, unknown>);
    },
    save: async (name: string): Promise<void> => {
      const res: Response = await fetch(url(name), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(serialize(captureState())),
      });
      if (!res.ok) throw new Error(await res.text());
    },
  };
}

/**
 * Apply a saved state at start-up — what `weave dev --state <name>` emits after the mount.
 *
 * The generated entry switches introspection on BEFORE the mount, and it has to: a signal registers
 * itself only if devtools were already on when it was created, so enabling it here would find an app
 * with no named signals and set nothing at all, silently.
 */
export async function startInState(name: string): Promise<void> {
  try {
    const applied: number = await devServerStates().apply(name);
    console.info(`weave: state "${name}" applied to ${applied} signal${applied === 1 ? '' : 's'}.`);
  } catch (err) {
    console.warn(`weave: could not apply state "${name}" — ${(err as Error).message}`);
  }
}
