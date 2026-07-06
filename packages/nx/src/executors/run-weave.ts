/**
 * Shared executor plumbing: build the `weave` CLI argument list for a command, and spawn the
 * CLI with `cwd` = the project root (so it resolves that project's `weave.config.*`). Kept thin
 * — the CLI does the real work (RFC 0004). The arg-builder is pure and unit-tested.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';

export interface BuildOptions {
  config?: string;
  noMinify?: boolean;
  outDir?: string;
  /**
   * Output directory (Nx convention: `dist/<projectRoot>` under the workspace root). When neither
   * `outputPath` nor `outDir` is set, the executor defaults it to `<workspaceRoot>/dist/<projectRoot>`
   * so a Weave app's build lands where every other Nx plugin puts it. Forwarded to the CLI as `--out`.
   */
  outputPath?: string;
}
export interface ServeOptions {
  config?: string;
  port?: number;
}
export type CheckOptions = Record<string, never>;

/** Build the `weave <command> …` argument list from a command + options. Pure. */
export function buildArgs(
  command: 'build' | 'dev' | 'check',
  options: BuildOptions & ServeOptions = {}
): string[] {
  const args: string[] = [command];
  if (options.config) args.push('--config', options.config);
  if (command === 'build') {
    const out: string | undefined = options.outputPath ?? options.outDir;
    if (out) args.push('--out', out);
    if (options.noMinify) args.push('--no-minify');
  }
  if (command === 'dev' && options.port != null) args.push('--port', String(options.port));
  return args;
}

/** Resolve the project root (relative to the workspace) from an executor context. */
export function projectRootOf(context: ExecutorContext): string {
  const name: string | undefined = context.projectName;
  const root: string | undefined = name
    ? context.projectsConfigurations?.projects?.[name]?.root
    : undefined;
  return root ?? '.';
}

/** Spawn the `weave` CLI with the given args in `cwd`. Resolves `{ success }` on exit. */
export function runWeave(args: string[], cwd: string): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    // `npx --no-install weave` resolves the workspace-local CLI; shell:true so Windows finds
    // the .cmd shim. The CLI is long-lived for `dev` — Nx tears it down via the process tree.
    const child: ChildProcess = spawn('npx', ['--no-install', 'weave', ...args], {
      cwd,
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', () => resolve({ success: false }));
    child.on('close', (code) => resolve({ success: code === 0 }));
  });
}

/**
 * Apply Nx-convention defaults to a build's options. When the project set neither `outputPath` nor
 * `outDir`, default `outputPath` to `<workspaceRoot>/dist/<projectRoot>` (absolute, so it's
 * unambiguous regardless of the CLI's cwd) — matching every other Nx plugin. Non-build commands and
 * projects that override the path pass through unchanged. Pure (no spawn) so it's unit-testable.
 */
export function withBuildDefaults(
  command: 'build' | 'dev' | 'check',
  options: BuildOptions & ServeOptions,
  context: ExecutorContext
): BuildOptions & ServeOptions {
  if (command !== 'build' || options.outputPath || options.outDir) return options;
  return { ...options, outputPath: join(context.root, 'dist', projectRootOf(context)) };
}

/** Run a weave command for the current project (context.cwd = its root). */
export async function runForProject(
  command: 'build' | 'dev' | 'check',
  options: BuildOptions & ServeOptions,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  const cwd: string = join(context.root, projectRootOf(context));
  return runWeave(buildArgs(command, withBuildDefaults(command, options, context)), cwd);
}
