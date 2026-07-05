/**
 * `@weave-framework/nx:library` — scaffold a Weave component library. v1 is an
 * imported-from-source library (one component + a barrel `index.ts`); a fully-bundled
 * publishable lib is a fast-follow (RFC 0004 §Open #1). Gets a `check` target only.
 */

import {
  addProjectConfiguration,
  formatFiles,
  joinPathFragments,
  names,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { componentFiles } from '../component/files.js';

export interface LibraryGeneratorSchema {
  name: string;
  directory?: string;
  style?: 'css' | 'scss' | 'none';
}

/** Compute the workspace-relative project root for a library (default under `libs/`). */
export function libRoot(name: string, directory?: string): string {
  const fileName: string = names(name).fileName;
  return directory ? joinPathFragments(directory, fileName) : joinPathFragments('libs', fileName);
}

export async function libraryGenerator(tree: Tree, schema: LibraryGeneratorSchema): Promise<string> {
  const fileName: string = names(schema.name).fileName;
  const root: string = libRoot(schema.name, schema.directory);
  const src: string = joinPathFragments(root, 'src');
  const style: 'css' | 'scss' | 'none' = schema.style ?? 'css';

  for (const file of componentFiles(joinPathFragments(src, 'lib', fileName), fileName, style)) {
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
  await formatFiles(tree);
  return root;
}

export default libraryGenerator;
