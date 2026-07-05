/** Pure content generation for the component generator — kebab file base + style → files. */

export interface GenFile {
  path: string;
  content: string;
}

/** The files for a component named `fileName` (already kebab-cased), rooted at `dir`. */
export function componentFiles(dir: string, fileName: string, style: 'css' | 'scss' | 'none'): GenFile[] {
  const files: GenFile[] = [];
  files.push({
    path: `${dir}/${fileName}.ts`,
    content:
      `import { signal, type Signal } from '@weave-framework/runtime';\n\n` +
      `export function setup(): { count: Signal<number>; inc: () => void } {\n` +
      `  const count: Signal<number> = signal(0);\n` +
      `  const inc = (): void => { count.set((n) => n + 1); };\n` +
      `  return { count, inc };\n` +
      `}\n`,
  });
  files.push({
    path: `${dir}/${fileName}.html`,
    content:
      `<section class="${fileName}">\n` +
      `  <button on:click={{ inc }}>clicked {{ count() }} times</button>\n` +
      `</section>\n`,
  });
  if (style !== 'none') {
    files.push({ path: `${dir}/${fileName}.${style}`, content: `.${fileName} {\n  display: block;\n}\n` });
  }
  return files;
}
