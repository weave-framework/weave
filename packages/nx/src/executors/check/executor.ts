import type { ExecutorContext } from '@nx/devkit';
import { runForProject, type CheckOptions } from '../run-weave.js';

/** `@weave-framework/nx:check` — run `weave check` (type-check templates + components). */
export default async function checkExecutor(
  _options: CheckOptions,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  return runForProject('check', {}, context);
}
