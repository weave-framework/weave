import type { ExecutorContext } from '@nx/devkit';
import { runForProject, type BuildOptions } from '../run-weave.js';

/** `@weave-framework/nx:build` — run `weave build` for the project. */
export default async function buildExecutor(
  options: BuildOptions,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  return runForProject('build', options ?? {}, context);
}
