import type { ExecutorContext } from '@nx/devkit';
import { runForProject, type ServeOptions } from '../run-weave.js';

/** `@weave-framework/nx:serve` — run `weave dev` (watch + live-reload) for the project. */
export default async function serveExecutor(
  options: ServeOptions,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  return runForProject('dev', options ?? {}, context);
}
