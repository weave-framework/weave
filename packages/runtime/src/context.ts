/**
 * Weave — tree context (`provide` / `inject`).
 *
 * Removes prop-drilling: a component provides a value, any descendant injects it.
 * Values live on the owner tree (see `reactive.ts`), so a provide is scoped to the
 * subtree under the owner that set it, and `inject` walks ancestors to the nearest
 * provider — falling back to the context's default. Because it rides the owner chain
 * (not a synchronous render stack), `inject` works in `setup`, in effects, and in
 * async callbacks alike, as long as it runs inside the owning scope.
 *
 * TypeScript-native: a `Context<T>` is an opaque token carrying `T`, so `inject(ctx)`
 * is fully typed and there are no string-key collisions.
 */

import { getOwner } from './reactive.js';
import type { Owner } from './reactive.js';

/** An opaque, typed context token. Create with `createContext`; never construct by hand. */
export interface Context<T> {
  /** Value returned by `inject` when no ancestor provided one. */
  readonly defaultValue: T | undefined;
}

/**
 * Create a context token. The optional `defaultValue` is what `inject` returns when
 * no ancestor `provide`d a value. The returned object's identity is the lookup key.
 */
export function createContext<T>(defaultValue?: T): Context<T> {
  return { defaultValue };
}

/**
 * Provide `value` for `context` on the current owner scope. Visible to every
 * descendant that `inject`s the same context until this scope disposes. Call inside
 * a component `setup` (or any active owner scope).
 */
export function provide<T>(context: Context<T>, value: T): void {
  const owner: Owner | null = getOwner();
  if (!owner) {
    throw new Error('weave: provide() must be called within a component setup or owner scope');
  }
  (owner._contexts ??= new Map()).set(context, value);
}

/**
 * Read the nearest ancestor-provided value for `context`, or the context's default
 * if none provided one. Walks the owner chain from the current scope upward.
 */
export function inject<T>(context: Context<T>): T {
  let owner: Owner | null = getOwner();
  while (owner) {
    const contexts: Map<object, unknown> | undefined = owner._contexts;
    if (contexts && contexts.has(context)) return contexts.get(context) as T;
    owner = owner._parent;
  }
  return context.defaultValue as T;
}
