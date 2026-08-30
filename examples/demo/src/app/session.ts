/**
 * App-level session context (A.1 provide/inject). The shell `provide`s it once at the
 * root; any descendant — a `TaskCard` deep inside the board's `@for`, or the deferred
 * insights panel — `inject`s it without prop-drilling through every layer between.
 */

import { createContext, type Context } from '@weave-framework/runtime';

export interface Session {
  /** The signed-in team member; cards they own get a "You" marker. */
  currentUser: string;
}

/** Default (empty) session when no ancestor provided one. */
export const SessionContext: Context<Session> = createContext<Session>({ currentUser: '' });
