/**
 * `@weave-framework/nx:library` — scaffold a Weave component library. v1 is an
 * imported-from-source library (one component + a barrel `index.ts`); a fully-bundled
 * publishable lib is a fast-follow (RFC 0004 §Open #1). Gets a `check` target only.
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
import { componentFiles, type GenFile } from '../component/files.js';

export interface LibraryGeneratorSchema {
  name: string;
  directory?: string;
  style?: 'css' | 'scss' | 'none';
}

/** Version range for the generated lib's `@weave-framework/*` deps — mirrors the create-weave template. */
const WEAVE_DEP_RANGE: "^1.0.0" = '^1.0.0';

/** Compute the workspace-relative project root for a library (default under `libs/`). */
export function libRoot(name: string, directory?: string): string {
  const fileName: string = names(name).fileName;
  return directory ? joinPathFragments(directory, fileName) : joinPathFragments('libs', fileName);
}

export async function libraryGenerator(
  tree: Tree,
  schema: LibraryGeneratorSchema
): Promise<GeneratorCallback> {
  const fileName: string = names(schema.name).fileName;
  const root: string = libRoot(schema.name, schema.directory);
  const src: string = joinPathFragments(root, 'src');
  const style: 'css' | 'scss' | 'none' = schema.style ?? 'css';

  const files: GenFile[] = componentFiles(joinPathFragments(src, 'lib', fileName), fileName, style);
  // Write everything except the Weave `.html` template now; the template is written after
  // formatFiles so Prettier can't mangle its `{{ }}` bindings.
  const htmlFiles: GenFile[] = files.filter((f) => f.path.endsWith('.html'));
  for (const file of files) {
    if (file.path.endsWith('.html')) continue;
    tree.write(file.path, file.content);
  }
  tree.write(joinPathFragments(src, 'index.ts'), `export { setup } from './lib/${fileName}/${fileName}.js';\n`);

  const project: ProjectConfiguration = {
    root,
    projectType: 'library',
    sourceRoot: src,
    targets: {
      check: { executor: '@weave-framework/nx:check', cache: true },
    },
  };
  addProjectConfiguration(tree, schema.name, project);

  // A Weave component imports the runtime; the `check` target needs the CLI. Adding them
  // returns an install task — a function, the shape Nx requires a generator to return.
  const installTask: GeneratorCallback = addDependenciesToPackageJson(
    tree,
    { '@weave-framework/runtime': WEAVE_DEP_RANGE },
    { '@weave-framework/cli': WEAVE_DEP_RANGE }
  );

  await formatFiles(tree);

  for (const file of htmlFiles) tree.write(file.path, file.content);

  return installTask;
}

export default libraryGenerator;
