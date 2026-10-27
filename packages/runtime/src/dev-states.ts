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

/** The state name the reload path saves under and reads back. */
const RELOAD_STATE: string = 'last-reload';
/** The sessionStorage flag the live-reload client sets right before it reloads — so the next load, and only it, applies. */
const RELOAD_FLAG: string = '__weaveKeepState';

/**
 * Carry the named signals across a live reload — what `weave dev --keep-state` emits after the mount.
 *
 * Live reload is a full page reload, and every save threw the screen away: the filled form, the open
 * dialog, the tenth page of the list. The reload client finds `globalThis.__weaveSaveState` and calls it
 * before reloading, which captures the named signals the way the States tab does and saves them under one
 * fixed name; the fresh page applies them once, after the mount. Only on a load the reload caused — the
 * client leaves a flag in sessionStorage, and this reads and clears it — so a new tab or a new dev session
 * starts clean, and yesterday's state is not resurrected by accident.
 *
 * What survives is exactly what `--state` would capture: signals with a `name`. An unnamed signal is not
 * state (see `captureState`), and nothing here changes that rule.
 */
export function keepStateAcrossReloads(): void {
  const states: StatesAdapter = devServerStates();
  (globalThis as Record<string, unknown>).__weaveSaveState = (): Promise<void> => states.save(RELOAD_STATE);
  let flagged: boolean = false;
  try {
    flagged = sessionStorage.getItem(RELOAD_FLAG) === '1';
    if (flagged) sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* no storage (a sandboxed frame): then nothing marks this load as a reload, and nothing is applied */
  }
  if (!flagged) return;
  void states
    .apply(RELOAD_STATE)
    .then((applied: number) => console.info(`weave: kept ${applied} named signal${applied === 1 ? '' : 's'} across the reload.`))
    .catch((err: Error) => console.warn(`weave: could not keep the state across the reload — ${err.message}`));
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
