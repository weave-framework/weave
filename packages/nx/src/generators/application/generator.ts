/**
 * `@weave-framework/nx:application` — scaffold a Weave app project into an Nx workspace and
 * register it with `build`/`serve`/`check` targets (wired to this plugin's executors). The
 * app mirrors the `create-weave` layout (root component + config + HTML shell).
 */

import {
  addDependenciesToPackageJson,
  addProjectConfiguration,
  formatFiles,
  type GeneratorCallback,
  joinPathFragments,
  names,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';

export interface ApplicationGeneratorSchema {
  name: string;
  directory?: string;
  style?: 'css' | 'scss';
}

/** Version range for the generated app's `@weave-framework/*` deps — mirrors the create-weave template. */
const WEAVE_DEP_RANGE = '^1.0.0';

/** Compute the workspace-relative project root for an app (default under `apps/`). */
export function appRoot(name: string, directory?: string): string {
  const fileName: string = names(name).fileName;
  return directory ? joinPathFragments(directory, fileName) : joinPathFragments('apps', fileName);
}

export async function applicationGenerator(
  tree: Tree,
  schema: ApplicationGeneratorSchema
): Promise<GeneratorCallback> {
  const style: 'css' | 'scss' = schema.style ?? 'css';
  const root: string = appRoot(schema.name, schema.directory);

  tree.write(
    joinPathFragments(root, 'weave.config.ts'),
    `import { defineConfig } from '@weave-framework/cli';\n\n` +
      `export default defineConfig({\n` +
      `  root: 'src/app/app',\n` +
      `  index: 'src/index.html',\n` +
      `  mount: '#app',\n` +
      `  styleLang: '${style}',\n` +
      `});\n`
  );
  tree.write(
    joinPathFragments(root, 'src/index.html'),
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n` +
      `    <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
      `    <title>${schema.name}</title>\n  </head>\n  <body>\n    <div id="app"></div>\n  </body>\n</html>\n`
  );
  tree.write(
    joinPathFragments(root, 'src/app/app.ts'),
    `import { signal, type Signal } from '@weave-framework/runtime';\n\n` +
      `export function setup(): { count: Signal<number>; inc: () => void } {\n` +
      `  const count: Signal<number> = signal(0);\n` +
      `  const inc = (): void => { count.set((n) => n + 1); };\n` +
      `  return { count, inc };\n` +
      `}\n`
  );
  tree.write(
    joinPathFragments(root, `src/app/app.${style}`),
    `.app {\n  font-family: system-ui, sans-serif;\n  text-align: center;\n  padding: 2rem;\n}\n`
  );

  const project: ProjectConfiguration = {
    root,
    projectType: 'application',
    sourceRoot: joinPathFragments(root, 'src'),
    targets: {
      build: {
        executor: '@weave-framework/nx:build',
        options: { config: 'weave.config.ts' },
        // The executor writes to `<workspaceRoot>/dist/<projectRoot>` (Nx convention, matching every
        // other plugin), so caching must point there — not the app-local `{projectRoot}/dist`.
        outputs: ['{workspaceRoot}/dist/{projectRoot}'],
        cache: true,
      },
      serve: { executor: '@weave-framework/nx:serve', options: { config: 'weave.config.ts' } },
      check: { executor: '@weave-framework/nx:check', cache: true },
    },
  };
  addProjectConfiguration(tree, schema.name, project);

  // Add the runtime deps the scaffold imports (mirrors create-weave) + the CLI dev dep.
  // The returned task installs them — and, crucially, is a *function*, which is the shape
  // Nx expects a generator to return (returning a non-function broke `nx g` with
  // "task is not a function").
  const installTask: GeneratorCallback = addDependenciesToPackageJson(
    tree,
    {
      '@weave-framework/runtime': WEAVE_DEP_RANGE,
      '@weave-framework/router': WEAVE_DEP_RANGE,
      '@weave-framework/store': WEAVE_DEP_RANGE,
      '@weave-framework/forms': WEAVE_DEP_RANGE,
      '@weave-framework/i18n': WEAVE_DEP_RANGE,
      '@weave-framework/data': WEAVE_DEP_RANGE,
    },
    { '@weave-framework/cli': WEAVE_DEP_RANGE, '@weave-framework/prettier-plugin': WEAVE_DEP_RANGE }
  );

  await formatFiles(tree);

  // Everything below is written AFTER `formatFiles` on purpose. `formatFiles` runs Prettier with
  // the workspace's *currently installed* plugins — and `@weave-framework/prettier-plugin` is only
  // installed by `installTask` afterwards. So during generation Prettier is still Weave-unaware and
  // would mangle `{{ }}` bindings (`on:click={{ inc }}` → `on:click="{{" inc }}`); writing the
  // template + the Prettier config here keeps them pristine. Once installed, the developer's own
  // Prettier picks up the config below and formats Weave templates correctly.
  tree.write(
    joinPathFragments(root, 'src/app/app.html'),
    `<main class="app">\n  <h1>Hello, Weave</h1>\n` +
      `  <button on:click={{ inc }}>clicked {{ count() }} times</button>\n</main>\n`
  );

  // Wire up the Weave Prettier plugin for this app: `.weave` files are picked up automatically;
  // route the app's Weave `.html` templates to the `weave` parser so plain HTML elsewhere is
  // untouched. This is what makes format-on-save / `prettier --check` work on templates.
  tree.write(
    joinPathFragments(root, '.prettierrc'),
    JSON.stringify(
      {
        plugins: ['@weave-framework/prettier-plugin'],
        overrides: [{ files: '*.html', options: { parser: 'weave' } }],
      },
      null,
      2
    ) + '\n'
  );

  return installTask;
}

export default applicationGenerator;
