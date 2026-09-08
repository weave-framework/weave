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
  /**
   * The specifier other code imports this library by (`@acme/auth`).
   *
   * Without one a generated library is unreachable: `addProjectConfiguration` writes `project.json`, which
   * tells Nx the project exists, and nothing tells TypeScript how to resolve a name to it. Found while making
   * `weave migrate` recreate an Angular workspace's libraries — every converted file imported `@sps-services/auth`
   * and no target library answered to that name.
   */
  importPath?: string;
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

  // The barrel, registered so the name resolves. Nx's own JS library generator does this; ours did not, and a
  // library nobody can import is not a library.
  if (schema.importPath) registerImportPath(tree, schema.importPath, joinPathFragments(src, 'index.ts'));

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

/**
 * Point a bare specifier at a library's barrel, in the workspace's base tsconfig.
 *
 * `tsconfig.base.json` is where an Nx workspace keeps these; a workspace that uses `tsconfig.json` instead is
 * handled too, because both exist in the wild and picking the wrong one writes a mapping nothing reads.
 */
export function registerImportPath(tree: Tree, importPath: string, barrel: string): void {
  const file: string | undefined = ['tsconfig.base.json', 'tsconfig.json'].find((f: string): boolean => tree.exists(f));
  if (!file) return;
  const raw: string = tree.read(file, 'utf-8') ?? '{}';
  let json: { compilerOptions?: { paths?: Record<string, string[]> } };
  try {
    json = JSON.parse(raw) as { compilerOptions?: { paths?: Record<string, string[]> } };
  } catch {
    // A base tsconfig with comments in it is common and not ours to rewrite badly.
    return;
  }
  json.compilerOptions = json.compilerOptions ?? {};
  json.compilerOptions.paths = json.compilerOptions.paths ?? {};
  json.compilerOptions.paths[importPath] = [barrel];
  tree.write(file, `${JSON.stringify(json, null, 2)}
`);
}

export default libraryGenerator;
