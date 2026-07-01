/**
 * SCSS token-engine test for @weave-framework/ui.
 *
 * Compiles small fixtures with dart-sass (a build tool, not a runtime dep) and
 * asserts the emitted CSS: theme() emits globals + component vars; define() emits
 * vars that reference globals (cascade); overrides() overrides + adds; scoped
 * override lands only under its selector; colors() is a partial recompile.
 */
import * as sass from 'sass';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const uiSrc = join(root, 'packages', 'ui', 'src');

// Resolve `@weave-framework/ui` (+ subpaths) to local scss files — self-contained,
// no node_modules symlink needed. Mirrors the dev's package-importer resolution.
const importer = {
  findFileUrl(url) {
    if (url === '@weave-framework/ui') {
      return pathToFileURL(join(uiSrc, 'styles', '_index.scss'));
    }
    if (url.startsWith('@weave-framework/ui/')) {
      const sub = url.slice('@weave-framework/ui/'.length);
      return pathToFileURL(join(uiSrc, sub, `_${sub}.scss`));
    }
    return null;
  },
};

function compile(source) {
  return sass.compileString(source, { importers: [importer], style: 'expanded' }).css.toLowerCase();
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✖ ${name}`);
  }
}

/* ── theme(): globals + component vars + cascade ── */
const cssTheme = compile(`@use '@weave-framework/ui' as weave;\n@include weave.theme();`);
check('theme emits :root', /:root\s*{/.test(cssTheme));
check('theme emits global color var', /--weave-color-ink:\s*#17181c/.test(cssTheme));
check('theme emits global shape var', /--weave-shape-radius:\s*4px/.test(cssTheme));
check('theme emits component var referencing global (cascade)', /--weave-divider-line:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits component literal var', /--weave-divider-thickness:\s*1px/.test(cssTheme));

/* ── partial override: change one key, keep the rest ── */
const cssPartial = compile(`@use '@weave-framework/ui' as weave;\n@include weave.theme((color: (accent: #2f9e8f)));`);
check('partial override changes accent', /--weave-color-accent:\s*#2f9e8f/.test(cssPartial));
check('partial override keeps default ink', /--weave-color-ink:\s*#17181c/.test(cssPartial));

/* ── colors(): partial recompile — only color concern ── */
const cssColors = compile(`@use '@weave-framework/ui' as weave;\n@include weave.colors();`);
check('colors() emits color global', /--weave-color-ink:/.test(cssColors));
check('colors() omits shape global', !/--weave-shape-radius:/.test(cssColors));
check('colors() emits component color token', /--weave-divider-line:/.test(cssColors));
check('colors() omits component size token', !/--weave-divider-thickness:/.test(cssColors));

/* ── define(): custom component, ref cascade + literal ── */
const cssDefine = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.define('rating', (color: (star: weave.ref('color.accent')), size: (gap: 4px)));`,
);
check('define() emits custom var referencing global', /--weave-rating-star:\s*var\(--weave-color-accent\)/.test(cssDefine));
check('define() emits custom literal', /--weave-rating-gap:\s*4px/.test(cssDefine));

/* ── overrides(): override existing + add new ── */
const cssOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.divider-overrides((thickness: 2px, margin-top: 8px));`,
);
check('override changes existing token', /--weave-divider-thickness:\s*2px/.test(cssOverride));
check('override adds new token (auto-var)', /--weave-divider-margin-top:\s*8px/.test(cssOverride));

/* ── scoped override: lands under the selector, not :root ── */
const cssScoped = compile(
  `@use '@weave-framework/ui' as weave;\n.compact { @include weave.divider-overrides((thickness: 2px)); }`,
);
check('scoped override under selector', /\.compact\s*{\s*--weave-divider-thickness:\s*2px/.test(cssScoped));
check('scoped override not at :root', !/:root/.test(cssScoped));

/* ── ripple built-in: opacity literal + duration referencing motion ── */
check('theme emits ripple opacity', /--weave-ripple-opacity:\s*0\.22/.test(cssTheme));
check('theme emits ripple duration referencing motion', /--weave-ripple-duration:\s*var\(--weave-motion-ripple\)/.test(cssTheme));

/* ── icon built-in: size + stroke literals; icon-overrides ── */
check('theme emits icon size literal', /--weave-icon-size:\s*18px/.test(cssTheme));
check('theme emits icon stroke literal', /--weave-icon-stroke:\s*1\.4/.test(cssTheme));
const cssIconOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.icon-overrides((size: 20px, gap: 6px));`,
);
check('icon-overrides changes existing token', /--weave-icon-size:\s*20px/.test(cssIconOverride));
check('icon-overrides adds new token (auto-var)', /--weave-icon-gap:\s*6px/.test(cssIconOverride));

/* ── all-styles(): structural CSS by class ── */
const cssStyles = compile(`@use '@weave-framework/ui' as weave;\n@include weave.all-styles();`);
check('all-styles emits .weave-divider rule', /\.weave-divider\s*{/.test(cssStyles));
check('divider rule consumes its token', /var\(--weave-divider-line\)/.test(cssStyles));
check('all-styles emits .weave-ripple rule', /\.weave-ripple\s*{/.test(cssStyles));
check('all-styles emits ripple keyframes', /@keyframes\s+weave-ripple/.test(cssStyles));
check('all-styles emits .weave-icon rule', /\.weave-icon\s*{/.test(cssStyles));
check('icon rule consumes its stroke token', /stroke-width:\s*var\(--weave-icon-stroke\)/.test(cssStyles));

/* ── example.scss: the docs-seed dev surface compiles end-to-end ── */
let exampleOk = false;
try {
  const css = compile(readFileSync(join(root, 'packages', 'ui', 'example.scss'), 'utf8'));
  exampleOk = /--weave-color-accent:\s*#5b5bd6/.test(css) && /\.weave-icon\s*{/.test(css) && /\.dense\s*{\s*--weave-icon-size:\s*16px/.test(css);
} catch (e) {
  console.log(`  (example.scss threw: ${e.message})`);
}
check('example.scss compiles (theme + all-styles + scoped override)', exampleOk);

console.log(`\n${'-'.repeat(40)}`);
console.log(`ui-sass  pass ${pass}  fail ${fail}`);
process.exit(fail > 0 ? 1 : 0);
