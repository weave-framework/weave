/**
 * `@weave-framework/nx:application` — scaffold a Weave app project into an Nx workspace and
 * register it with `build`/`serve`/`check` targets (wired to this plugin's executors). The
 * app mirrors the `create-weave` layout (root component + config + HTML shell).
 */

import {
  addProjectConfiguration,
  formatFiles,
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

/** Compute the workspace-relative project root for an app (default under `apps/`). */
export function appRoot(name: string, directory?: string): string {
  const fileName: string = names(name).fileName;
  return directory ? joinPathFragments(directory, fileName) : joinPathFragments('apps', fileName);
}

export async function applicationGenerator(tree: Tree, schema: ApplicationGeneratorSchema): Promise<string> {
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
      `  const inc = (): void => count.set((n) => n + 1);\n` +
      `  return { count, inc };\n` +
      `}\n`
  );
  tree.write(
    joinPathFragments(root, 'src/app/app.html'),
    `<main class="app">\n  <h1>Hello, Weave</h1>\n` +
      `  <button on:click={{ inc }}>clicked {{ count() }} times</button>\n</main>\n`
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
        outputs: ['{projectRoot}/dist'],
        cache: true,
      },
      serve: { executor: '@weave-framework/nx:serve', options: { config: 'weave.config.ts' } },
      check: { executor: '@weave-framework/nx:check', cache: true },
    },
  };
  addProjectConfiguration(tree, schema.name, project);
  await formatFiles(tree);
  return root;
}

export default applicationGenerator;
