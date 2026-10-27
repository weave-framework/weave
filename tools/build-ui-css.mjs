/**
 * The prebuilt stylesheet `@weave-framework/ui` ships: `theme()` with its defaults plus `all-styles()`,
 * compiled once here and published as `dist/weave-ui.css` (exported as `@weave-framework/ui/weave-ui.css`).
 *
 * Why it exists: getting the first `<Button>` on screen took four steps — install `sass`, switch the project
 * to `styleLang: 'scss'`, rename the component stylesheets, author a global Sass entry and register it —
 * and the failure mode of missing any of them was silent: a correct, accessible, completely unstyled
 * control. With this file the install is the package plus one `styles` line, no Sass anywhere, and the
 * theme is still retunable from plain CSS because every token is a custom property on `:root`.
 *
 * The Sass entry stays the full-power path (`theme($overrides)`, per-component imports); this is the
 * default output of it, nothing else.
 *
 * Run: `node tools/build-ui-css.mjs` (part of `pnpm build:packages`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Compile the default theme + every component's structural CSS to one stylesheet. Returns the CSS. */
export async function buildUiCss() {
  const sass = await import('sass');
  const styles = join(repo, 'packages', 'ui', 'src', 'styles');
  const result = sass.compileString(
    ["@use 'index' as weave;", '@include weave.theme();', '@include weave.all-styles();', ''].join('\n'),
    { loadPaths: [styles], style: 'expanded' }
  );
  return result.css;
}

/** Write it where the package exports it from. Returns the path written. */
export async function writeUiCss() {
  const css = await buildUiCss();
  const out = join(repo, 'packages', 'ui', 'dist', 'weave-ui.css');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, css);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = await writeUiCss();
  console.log(`weave-ui.css → ${out}`);
}
