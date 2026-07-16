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
import { componentFiles, type GenFile } from './files.js';

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

  const files: GenFile[] = componentFiles(dir, fileName, style);
  // Write the Weave `.html` template after formatFiles so Prettier can't mangle its
  // `{{ }}` bindings (e.g. `on:click={{ inc }}` → `on:click="{{" inc }}`).
  const htmlFiles: GenFile[] = files.filter((f) => f.path.endsWith('.html'));
  for (const file of files) {
    if (file.path.endsWith('.html')) continue;
    tree.write(file.path, file.content);
  }
  await formatFiles(tree);
  for (const file of htmlFiles) tree.write(file.path, file.content);
}

export default componentGenerator;
