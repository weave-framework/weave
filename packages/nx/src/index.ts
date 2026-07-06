/**
 * @weave-framework/nx — an Nx plugin that makes a Weave app a first-class Nx project:
 * inferred build/serve/check targets (crystal `createNodesV2`), executors, and generators.
 * Register the inference in `nx.json` as `"@weave-framework/nx/plugin"`. Purely additive —
 * the core runtime/compiler/CLI are unchanged; executors thin-wrap the existing `weave` CLI.
 *
 * `@nx/devkit` is a dev-time dependency of the plugin (correct for an Nx plugin) — the Weave
 * runtime/compiler/router stay zero-dependency ([[weave-zero-dependencies]] / RFC 0004).
 */

export {
  createNodesV2,
  buildWeaveTargets,
  readOutDir,
  WEAVE_CONFIG_GLOB,
  type WeaveNxPluginOptions,
} from './plugin.js';

export { buildArgs, runWeave, projectRootOf, runForProject, withBuildDefaults } from './executors/run-weave.js';
export type { BuildOptions, ServeOptions, CheckOptions } from './executors/run-weave.js';

export { applicationGenerator, appRoot, type ApplicationGeneratorSchema } from './generators/application/generator.js';
export { libraryGenerator, libRoot, type LibraryGeneratorSchema } from './generators/library/generator.js';
export { componentGenerator, type ComponentGeneratorSchema } from './generators/component/generator.js';
export { componentFiles, type GenFile } from './generators/component/files.js';
