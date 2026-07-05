/**
 * The Nx "crystal" inference plugin: for every `weave.config.{ts,js,json}` in the workspace,
 * infer `build` / `serve` / `check` targets on that project — no target boilerplate in
 * `project.json`. Registered in `nx.json` as `"@weave-framework/nx/plugin"`.
 *
 * Targets run the existing `weave` CLI with `cwd` = the project root, so the CLI resolves
 * the project's own `weave.config.*` (RFC 0004: no CLI change needed). Cache inputs cover
 * the project's source/config/templates/styles; the build's output is the config's `outDir`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createNodesFromFiles } from '@nx/devkit';
import type {
  CreateNodesContext,
  CreateNodesResult,
  CreateNodesV2,
  ProjectConfiguration,
  TargetConfiguration,
} from '@nx/devkit';

/** Options (2nd arg in nx.json) — override the inferred target names so it co-exists with other plugins. */
export interface WeaveNxPluginOptions {
  buildTargetName?: string;
  serveTargetName?: string;
  checkTargetName?: string;
}

/** The config files this plugin infers from. */
export const WEAVE_CONFIG_GLOB: string = '**/weave.config.{ts,js,json}';

/** Shallow-read `outDir` from a weave config's text (no esbuild at inference time). Default `dist`. */
export function readOutDir(configText: string): string {
  // Matches `outDir: 'x'` (ts) and `"outDir": "x"` (json — optional closing key quote). First hit wins.
  const m: RegExpMatchArray | null = configText.match(/outDir['"]?\s*:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : 'dist';
}

/**
 * Compute the inferred targets for one project. Pure over its inputs (project root, config
 * file basename, resolved outDir, options) — the unit-testable heart of the plugin.
 */
export function buildWeaveTargets(
  projectRoot: string,
  configBasename: string,
  outDir: string,
  options: WeaveNxPluginOptions = {}
): Record<string, TargetConfiguration> {
  const buildName: string = options.buildTargetName ?? 'build';
  const serveName: string = options.serveTargetName ?? 'serve';
  const checkName: string = options.checkTargetName ?? 'check';

  // Cache inputs: this project's own files + config/templates/styles + the CLI version.
  const inputs: Array<string | { externalDependencies: string[] }> = [
    '{projectRoot}/**/*',
    { externalDependencies: ['@weave-framework/cli'] },
  ];

  return {
    [buildName]: {
      command: `weave build --config ${configBasename}`,
      options: { cwd: projectRoot },
      cache: true,
      inputs,
      outputs: [`{projectRoot}/${outDir}`],
    },
    [serveName]: {
      command: `weave dev --config ${configBasename}`,
      options: { cwd: projectRoot },
    },
    [checkName]: {
      command: 'weave check',
      options: { cwd: projectRoot },
      cache: true,
      inputs,
    },
  };
}

/** Build the project entry for one discovered config file (or `{}` if it isn't a real project). */
function createProjectFromConfigFile(
  configFile: string,
  options: WeaveNxPluginOptions | undefined,
  context: CreateNodesContext
): CreateNodesResult {
  const projectRoot: string = dirname(configFile);
  const absRoot: string = join(context.workspaceRoot, projectRoot);

  // Only treat a dir as a project if it carries a project marker — avoids registering targets
  // on an incidental config found in a nested/example dir (standard Nx crystal guard).
  const siblings: string[] = existsSync(absRoot) ? readdirSync(absRoot) : [];
  if (!siblings.includes('project.json') && !siblings.includes('package.json')) {
    return {};
  }

  const configText: string = readFileSync(join(context.workspaceRoot, configFile), 'utf8');
  const outDir: string = readOutDir(configText);
  const targets: Record<string, TargetConfiguration> = buildWeaveTargets(
    projectRoot,
    basename(configFile),
    outDir,
    options ?? {}
  );

  const project: ProjectConfiguration = { root: projectRoot, targets };
  return { projects: { [projectRoot]: project } };
}

/** The Nx crystal entry point — glob + a per-file inference callback. */
export const createNodesV2: CreateNodesV2<WeaveNxPluginOptions> = [
  WEAVE_CONFIG_GLOB,
  (configFiles, options, context) =>
    createNodesFromFiles(
      (configFile, opts, ctx) => createProjectFromConfigFile(configFile, opts, ctx),
      configFiles,
      options,
      context
    ),
];
