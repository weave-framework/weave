/**
 * `@weave-framework/nx:component` — generate a Weave component (sibling `.ts` + `.html`
 * [+ style]) into an existing project, honoring its `styleLang`.
 */

import {
  formatFiles,
  joinPathFragments,
  names,
  readProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { componentFiles } from './files.js';

export interface ComponentGeneratorSchema {
  name: string;
  project: string;
  directory?: string;
  style?: 'css' | 'scss' | 'none';
}

export async function componentGenerator(tree: Tree, schema: ComponentGeneratorSchema): Promise<void> {
  const project: ProjectConfiguration = readProjectConfiguration(tree, schema.project);
  const fileName: string = names(schema.name).fileName;
  const sourceRoot: string = project.sourceRoot ?? joinPathFragments(project.root, 'src');
  const dir: string = joinPathFragments(sourceRoot, schema.directory ?? '', fileName);
  const style: 'css' | 'scss' | 'none' = schema.style ?? 'css';

  for (const file of componentFiles(dir, fileName, style)) {
    tree.write(file.path, file.content);
  }
  await formatFiles(tree);
}

export default componentGenerator;
