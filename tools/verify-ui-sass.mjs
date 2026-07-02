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
      // Component SCSS lives under styles/components/<name>/ (a barrel _index.scss forwards
      // the split _tokens + _styles partials). Behavior .ts stays per-component folder.
      const sub = url.slice('@weave-framework/ui/'.length);
      return pathToFileURL(join(uiSrc, 'styles', 'components', sub, '_index.scss'));
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

/* ── button built-in: cascade ref (color) + literals (size/typography) + overrides ── */
check('theme emits button background referencing ink (cascade)', /--weave-button-background:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits button padding literal', /--weave-button-padding-x:\s*18px/.test(cssTheme));
check('theme emits button weight literal', /--weave-button-weight:\s*600/.test(cssTheme));
check('theme emits button duration referencing motion', /--weave-button-duration:\s*var\(--weave-motion-fast\)/.test(cssTheme));
const cssButtonOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.button-overrides((radius: 6px, elevation: 2px));`,
);
check('button-overrides changes existing token', /--weave-button-radius:\s*6px/.test(cssButtonOverride));
check('button-overrides adds new token (auto-var)', /--weave-button-elevation:\s*2px/.test(cssButtonOverride));

/* ── button-toggle built-in: cascade ref + literals + overrides ── */
check('theme emits button-toggle selected-background referencing ink', /--weave-button-toggle-selected-background:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits button-toggle border referencing line', /--weave-button-toggle-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits button-toggle padding literal', /--weave-button-toggle-padding-x:\s*12px/.test(cssTheme));
const cssBtnToggleOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.button-toggle-overrides((radius: 6px, gap: 2px));`,
);
check('button-toggle-overrides changes existing token', /--weave-button-toggle-radius:\s*6px/.test(cssBtnToggleOverride));
check('button-toggle-overrides adds new token (auto-var)', /--weave-button-toggle-gap:\s*2px/.test(cssBtnToggleOverride));

/* ── badge built-in: cascade ref (accent) + literals + overrides ── */
check('theme emits badge background referencing accent', /--weave-badge-background:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits badge dot referencing error', /--weave-badge-dot:\s*var\(--weave-color-error\)/.test(cssTheme));
check('theme emits badge min-size literal', /--weave-badge-min-size:\s*15px/.test(cssTheme));
const cssBadgeOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.badge-overrides((min-size: 18px, offset: 2px));`,
);
check('badge-overrides changes existing token', /--weave-badge-min-size:\s*18px/.test(cssBadgeOverride));
check('badge-overrides adds new token (auto-var)', /--weave-badge-offset:\s*2px/.test(cssBadgeOverride));

/* ── card built-in: cascade refs (surface/line) + literals + overrides ── */
check('theme emits card background referencing surface', /--weave-card-background:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits card border referencing line', /--weave-card-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits card padding literal', /--weave-card-padding:\s*16px/.test(cssTheme));
const cssCardOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.card-overrides((padding: 20px, elevation: 1px));`,
);
check('card-overrides changes existing token', /--weave-card-padding:\s*20px/.test(cssCardOverride));
check('card-overrides adds new token (auto-var)', /--weave-card-elevation:\s*1px/.test(cssCardOverride));

/* ── toolbar built-in: cascade refs + literals + overrides ── */
check('theme emits toolbar background referencing surface', /--weave-toolbar-background:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits toolbar height literal', /--weave-toolbar-height:\s*52px/.test(cssTheme));
const cssToolbarOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.toolbar-overrides((height: 56px, elevation: 1px));`,
);
check('toolbar-overrides changes existing token', /--weave-toolbar-height:\s*56px/.test(cssToolbarOverride));
check('toolbar-overrides adds new token (auto-var)', /--weave-toolbar-elevation:\s*1px/.test(cssToolbarOverride));

/* ── list built-in: cascade refs + accentSoft color-mix + literals + overrides ── */
check('theme emits list selected-marker referencing accent', /--weave-list-selected-marker:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits list selected-background as accentSoft color-mix', /--weave-list-selected-background:\s*color-mix\(in srgb, var\(--weave-color-accent\) 12%, transparent\)/.test(cssTheme));
check('theme emits list row-height literal', /--weave-list-row-height:\s*34px/.test(cssTheme));
const cssListOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.list-overrides((row-height: 40px, gap: 8px));`,
);
check('list-overrides changes existing token', /--weave-list-row-height:\s*40px/.test(cssListOverride));
check('list-overrides adds new token (auto-var)', /--weave-list-gap:\s*8px/.test(cssListOverride));

/* ── grid-list built-in: cascade refs + literals + overrides ── */
check('theme emits grid-list accent-background referencing accent', /--weave-grid-list-accent-background:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits grid-list min-tile literal', /--weave-grid-list-min-tile:\s*96px/.test(cssTheme));
check('theme emits grid-list gap literal', /--weave-grid-list-gap:\s*1px/.test(cssTheme));
const cssGridListOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.grid-list-overrides((min-tile: 120px, ratio: 1.5));`,
);
check('grid-list-overrides changes existing token', /--weave-grid-list-min-tile:\s*120px/.test(cssGridListOverride));
check('grid-list-overrides adds new token (auto-var)', /--weave-grid-list-ratio:\s*1\.5/.test(cssGridListOverride));

/* ── progress-bar built-in: cascade refs + literals + overrides ── */
check('theme emits progress-bar fill referencing accent', /--weave-progress-bar-fill:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits progress-bar track referencing field', /--weave-progress-bar-track:\s*var\(--weave-color-field\)/.test(cssTheme));
check('theme emits progress-bar height literal', /--weave-progress-bar-height:\s*4px/.test(cssTheme));
const cssProgressBarOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.progress-bar-overrides((height: 6px, buffer: #ccc));`,
);
check('progress-bar-overrides changes existing token', /--weave-progress-bar-height:\s*6px/.test(cssProgressBarOverride));
check('progress-bar-overrides adds new token (auto-var)', /--weave-progress-bar-buffer:\s*#ccc/.test(cssProgressBarOverride));

/* ── progress-spinner built-in: cascade refs + literals + overrides ── */
check('theme emits progress-spinner indicator referencing accent', /--weave-progress-spinner-indicator:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits progress-spinner track referencing field', /--weave-progress-spinner-track:\s*var\(--weave-color-field\)/.test(cssTheme));
check('theme emits progress-spinner diameter literal', /--weave-progress-spinner-diameter:\s*26px/.test(cssTheme));
const cssSpinnerOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.progress-spinner-overrides((thickness: 3px, diameter-large: 40px));`,
);
check('progress-spinner-overrides changes existing token', /--weave-progress-spinner-thickness:\s*3px/.test(cssSpinnerOverride));
check('progress-spinner-overrides adds new token (auto-var)', /--weave-progress-spinner-diameter-large:\s*40px/.test(cssSpinnerOverride));

/* ── checkbox built-in: cascade refs + literals + overrides ── */
check('theme emits checkbox checked-background referencing accent', /--weave-checkbox-checked-background:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits checkbox border referencing line', /--weave-checkbox-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits checkbox size literal', /--weave-checkbox-size:\s*20px/.test(cssTheme));
const cssCheckboxOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.checkbox-overrides((size: 24px, gap: 10px));`,
);
check('checkbox-overrides changes existing token', /--weave-checkbox-size:\s*24px/.test(cssCheckboxOverride));
check('checkbox-overrides adds new token (auto-var)', /--weave-checkbox-gap:\s*10px/.test(cssCheckboxOverride));

/* ── radio built-in: cascade refs + literals + overrides ── */
check('theme emits radio dot referencing accent', /--weave-radio-dot:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits radio border referencing line', /--weave-radio-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits radio dot-size literal', /--weave-radio-dot-size:\s*8px/.test(cssTheme));
const cssRadioOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.radio-overrides((dot-size: 10px, ring: 2px));`,
);
check('radio-overrides changes existing token', /--weave-radio-dot-size:\s*10px/.test(cssRadioOverride));
check('radio-overrides adds new token (auto-var)', /--weave-radio-ring:\s*2px/.test(cssRadioOverride));

/* ── slide-toggle built-in: cascade refs + literals + overrides ── */
check('theme emits slide-toggle track-on referencing accent', /--weave-slide-toggle-track-on:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits slide-toggle knob-off referencing ink', /--weave-slide-toggle-knob-off:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits slide-toggle track-width literal', /--weave-slide-toggle-track-width:\s*42px/.test(cssTheme));
const cssSlideToggleOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.slide-toggle-overrides((track-width: 48px, elevation: 1px));`,
);
check('slide-toggle-overrides changes existing token', /--weave-slide-toggle-track-width:\s*48px/.test(cssSlideToggleOverride));
check('slide-toggle-overrides adds new token (auto-var)', /--weave-slide-toggle-elevation:\s*1px/.test(cssSlideToggleOverride));

/* ── form-field built-in: cascade refs + literals + overrides ── */
check('theme emits form-field error referencing error color', /--weave-form-field-error:\s*var\(--weave-color-error\)/.test(cssTheme));
check('theme emits form-field label referencing sub', /--weave-form-field-label:\s*var\(--weave-color-sub\)/.test(cssTheme));
check('theme emits form-field label-size literal', /--weave-form-field-label-size:\s*10px/.test(cssTheme));
const cssFormFieldOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.form-field-overrides((gap: 8px, message-weight: 500));`,
);
check('form-field-overrides changes existing token', /--weave-form-field-gap:\s*8px/.test(cssFormFieldOverride));
check('form-field-overrides adds new token (auto-var)', /--weave-form-field-message-weight:\s*500/.test(cssFormFieldOverride));

/* ── input built-in: cascade refs + literals + overrides ── */
check('theme emits input focus referencing accent', /--weave-input-focus:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits input border referencing line', /--weave-input-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits input font-size literal', /--weave-input-font-size:\s*13px/.test(cssTheme));
const cssInputOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.input-overrides((gap: 6px, radius: 4px));`,
);
check('input-overrides changes existing token', /--weave-input-gap:\s*6px/.test(cssInputOverride));
check('input-overrides adds new token (auto-var)', /--weave-input-radius:\s*4px/.test(cssInputOverride));

/* ── chips built-in: cascade refs + literals + overrides ── */
check('theme emits chips border referencing line', /--weave-chips-border:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits chips remove referencing sub', /--weave-chips-remove:\s*var\(--weave-color-sub\)/.test(cssTheme));
check('theme emits chips radius literal', /--weave-chips-radius:\s*3px/.test(cssTheme));
const cssChipsOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.chips-overrides((radius: 4px, elevation: 1px));`,
);
check('chips-overrides changes existing token', /--weave-chips-radius:\s*4px/.test(cssChipsOverride));
check('chips-overrides adds new token (auto-var)', /--weave-chips-elevation:\s*1px/.test(cssChipsOverride));

/* ── overlay shared republic: cascade refs + literals + overrides (U3 foundation) ── */
check('theme emits overlay surface referencing surface', /--weave-overlay-surface:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits overlay line referencing line', /--weave-overlay-line:\s*var\(--weave-color-line\)/.test(cssTheme));
check('theme emits overlay radius referencing shape', /--weave-overlay-radius:\s*var\(--weave-shape-radius\)/.test(cssTheme));
check('theme emits overlay backdrop scrim literal', /--weave-overlay-backdrop:\s*rgba\(20,\s*22,\s*28,\s*0\.32\)/.test(cssTheme));
check('theme emits overlay min-width literal', /--weave-overlay-min-width:\s*180px/.test(cssTheme));
const cssOverlayOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.overlay-overrides((radius: 6px, elevation: 2px));`,
);
check('overlay-overrides changes existing token', /--weave-overlay-radius:\s*6px/.test(cssOverlayOverride));
check('overlay-overrides adds new token (auto-var)', /--weave-overlay-elevation:\s*2px/.test(cssOverlayOverride));

/* ── tooltip built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits tooltip background referencing ink', /--weave-tooltip-background:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits tooltip text referencing surface', /--weave-tooltip-text:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits tooltip font-size literal', /--weave-tooltip-font-size:\s*11px/.test(cssTheme));
const cssTooltipOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.tooltip-overrides((max-width: 320px, arrow: 4px));`,
);
check('tooltip-overrides changes existing token', /--weave-tooltip-max-width:\s*320px/.test(cssTooltipOverride));
check('tooltip-overrides adds new token (auto-var)', /--weave-tooltip-arrow:\s*4px/.test(cssTooltipOverride));

/* ── menu built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits menu item-hover referencing field', /--weave-menu-item-hover:\s*var\(--weave-color-field\)/.test(cssTheme));
check('theme emits menu item-text referencing ink', /--weave-menu-item-text:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits menu item-height literal', /--weave-menu-item-height:\s*32px/.test(cssTheme));
const cssMenuOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.menu-overrides((min-width: 220px, elevation: 1px));`,
);
check('menu-overrides changes existing token', /--weave-menu-min-width:\s*220px/.test(cssMenuOverride));
check('menu-overrides adds new token (auto-var)', /--weave-menu-elevation:\s*1px/.test(cssMenuOverride));

/* ── dialog built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits dialog surface referencing surface', /--weave-dialog-surface:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits dialog width literal (default 560)', /--weave-dialog-width:\s*560px/.test(cssTheme));
check('theme emits dialog margin literal', /--weave-dialog-margin:\s*16px/.test(cssTheme));
const cssDialogOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.dialog-overrides((width: 640px, elevation: 1px));`,
);
check('dialog-overrides changes existing token', /--weave-dialog-width:\s*640px/.test(cssDialogOverride));
check('dialog-overrides adds new token (auto-var)', /--weave-dialog-elevation:\s*1px/.test(cssDialogOverride));

/* ── bottom-sheet built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits bottom-sheet surface referencing surface', /--weave-bottom-sheet-surface:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits bottom-sheet max-height literal', /--weave-bottom-sheet-max-height:\s*72vh/.test(cssTheme));
const cssSheetOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.bottom-sheet-overrides((max-width: 720px, handle: 4px));`,
);
check('bottom-sheet-overrides changes existing token', /--weave-bottom-sheet-max-width:\s*720px/.test(cssSheetOverride));
check('bottom-sheet-overrides adds new token (auto-var)', /--weave-bottom-sheet-handle:\s*4px/.test(cssSheetOverride));

/* ── snackbar built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits snackbar background referencing ink (inverted bar)', /--weave-snackbar-background:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits snackbar action referencing accent', /--weave-snackbar-action:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits snackbar offset literal', /--weave-snackbar-offset:\s*24px/.test(cssTheme));
const cssSnackbarOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.snackbar-overrides((offset: 32px, shadow: 1px));`,
);
check('snackbar-overrides changes existing token', /--weave-snackbar-offset:\s*32px/.test(cssSnackbarOverride));
check('snackbar-overrides adds new token (auto-var)', /--weave-snackbar-shadow:\s*1px/.test(cssSnackbarOverride));

/* ── select built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits select focus referencing accent', /--weave-select-focus:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits select option-selected as an accent color-mix', /--weave-select-option-selected:\s*color-mix\(in srgb, var\(--weave-color-accent\) 12%, transparent\)/.test(cssTheme));
check('theme emits select panel-max-height literal', /--weave-select-panel-max-height:\s*280px/.test(cssTheme));
const cssSelectOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.select-overrides((panel-max-height: 320px, gap: 10px));`,
);
check('select-overrides changes existing token', /--weave-select-panel-max-height:\s*320px/.test(cssSelectOverride));
check('select-overrides adds new token (auto-var)', /--weave-select-gap:\s*10px/.test(cssSelectOverride));

/* ── autocomplete built-in: cascade refs + literals + overrides (U3) ── */
check('theme emits autocomplete option-hover referencing field', /--weave-autocomplete-option-hover:\s*var\(--weave-color-field\)/.test(cssTheme));
check('theme emits autocomplete panel-max-height literal', /--weave-autocomplete-panel-max-height:\s*280px/.test(cssTheme));
const cssAcOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.autocomplete-overrides((panel-max-height: 320px, shadow: 1px));`,
);
check('autocomplete-overrides changes existing token', /--weave-autocomplete-panel-max-height:\s*320px/.test(cssAcOverride));
check('autocomplete-overrides adds new token (auto-var)', /--weave-autocomplete-shadow:\s*1px/.test(cssAcOverride));

/* ── expansion built-in: cascade refs + literals + overrides (U4) ── */
check('theme emits expansion header-open-background referencing field', /--weave-expansion-header-open-background:\s*var\(--weave-color-field\)/.test(cssTheme));
check('theme emits expansion header-height literal', /--weave-expansion-header-height:\s*44px/.test(cssTheme));
const cssExpansionOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.expansion-overrides((header-height: 52px, gap: 8px));`,
);
check('expansion-overrides changes existing token', /--weave-expansion-header-height:\s*52px/.test(cssExpansionOverride));
check('expansion-overrides adds new token (auto-var)', /--weave-expansion-gap:\s*8px/.test(cssExpansionOverride));

/* ── tabs built-in: cascade refs + literals + overrides (U4) ── */
check('theme emits tabs active text referencing ink', /--weave-tabs-text-active:\s*var\(--weave-color-ink\)/.test(cssTheme));
check('theme emits tabs marker referencing accent', /--weave-tabs-marker:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits tabs marker-size literal (5px)', /--weave-tabs-marker-size:\s*5px/.test(cssTheme));
const cssTabsOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.tabs-overrides((marker-size: 6px, radius: 3px));`,
);
check('tabs-overrides changes existing token', /--weave-tabs-marker-size:\s*6px/.test(cssTabsOverride));
check('tabs-overrides adds new token (auto-var)', /--weave-tabs-radius:\s*3px/.test(cssTabsOverride));

/* ── stepper built-in: cascade refs + literals + overrides (U4) ── */
check('theme emits stepper active-background referencing accent', /--weave-stepper-active-background:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits stepper indicator-size literal (26px)', /--weave-stepper-indicator-size:\s*26px/.test(cssTheme));
check('theme emits stepper on-accent as a fixed light literal', /--weave-stepper-on-accent:\s*#fff/.test(cssTheme));
const cssStepperOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.stepper-overrides((indicator-size: 30px, ring: 2px));`,
);
check('stepper-overrides changes existing token', /--weave-stepper-indicator-size:\s*30px/.test(cssStepperOverride));
check('stepper-overrides adds new token (auto-var)', /--weave-stepper-ring:\s*2px/.test(cssStepperOverride));

/* ── slider built-in: cascade refs + literals + overrides (U4) ── */
check('theme emits slider fill referencing accent', /--weave-slider-fill:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits slider thumb dims literals (3×18) + 5px cap', /--weave-slider-thumb-width:\s*3px/.test(cssTheme) && /--weave-slider-thumb-height:\s*18px/.test(cssTheme) && /--weave-slider-cap-size:\s*5px/.test(cssTheme));
const cssSliderOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.slider-overrides((track-height: 4px, tick: 1px));`,
);
check('slider-overrides changes existing token', /--weave-slider-track-height:\s*4px/.test(cssSliderOverride));
check('slider-overrides adds new token (auto-var)', /--weave-slider-tick:\s*1px/.test(cssSliderOverride));

/* ── paginator built-in: cascade refs + literals + overrides (U4) ── */
check('theme emits paginator range referencing sub', /--weave-paginator-range:\s*var\(--weave-color-sub\)/.test(cssTheme));
check('theme emits paginator button size literal (28px)', /--weave-paginator-button:\s*28px/.test(cssTheme));
const cssPaginatorOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.paginator-overrides((button: 32px, elevation: 1px));`,
);
check('paginator-overrides changes existing token', /--weave-paginator-button:\s*32px/.test(cssPaginatorOverride));
check('paginator-overrides adds new token (auto-var)', /--weave-paginator-elevation:\s*1px/.test(cssPaginatorOverride));

/* ── sidenav built-in: cascade refs + width literal + backdrop reuses the overlay scrim (U4) ── */
check('theme emits sidenav drawer background referencing surface', /--weave-sidenav-drawer-background:\s*var\(--weave-color-surface\)/.test(cssTheme));
check('theme emits sidenav width literal (230px)', /--weave-sidenav-width:\s*230px/.test(cssTheme));
check('sidenav backdrop reuses the shared overlay scrim token (no duplicated tone)', /--weave-sidenav-backdrop:\s*var\(--weave-overlay-backdrop\)/.test(cssTheme));
const cssSidenavOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.sidenav-overrides((width: 280px, elevation: 1px));`,
);
check('sidenav-overrides changes existing token', /--weave-sidenav-width:\s*280px/.test(cssSidenavOverride));
check('sidenav-overrides adds new token (auto-var)', /--weave-sidenav-elevation:\s*1px/.test(cssSidenavOverride));

/* ── table built-in: cascade refs + accentSoft selected tint + literals + overrides (U4) ── */
check('theme emits table selected tint (accentSoft color-mix)', /--weave-table-selected-background:\s*color-mix\(in srgb, var\(--weave-color-accent\) 12%, transparent\)/.test(cssTheme));
check('theme emits table row-height literal (34px)', /--weave-table-row-height:\s*34px/.test(cssTheme));
const cssTableOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.table-overrides((row-height: 40px, elevation: 1px));`,
);
check('table-overrides changes existing token', /--weave-table-row-height:\s*40px/.test(cssTableOverride));
check('table-overrides adds new token (auto-var)', /--weave-table-elevation:\s*1px/.test(cssTableOverride));

/* ── tree built-in: cascade refs + accentSoft selected tint + indent literal + overrides (U4) ── */
check('theme emits tree selected tint (accentSoft color-mix)', /--weave-tree-selected-background:\s*color-mix\(in srgb, var\(--weave-color-accent\) 12%, transparent\)/.test(cssTheme));
check('theme emits tree indent literal (18px)', /--weave-tree-indent:\s*18px/.test(cssTheme));
const cssTreeOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.tree-overrides((indent: 24px, elevation: 1px));`,
);
check('tree-overrides changes existing token', /--weave-tree-indent:\s*24px/.test(cssTreeOverride));
check('tree-overrides adds new token (auto-var)', /--weave-tree-elevation:\s*1px/.test(cssTreeOverride));

/* ── datepicker built-in: cascade refs + selected/today calendar tokens + overrides (U4) ── */
check('theme emits datepicker selected-day fill (accent) + today ring', /--weave-datepicker-selected-background:\s*var\(--weave-color-accent\)/.test(cssTheme) && /--weave-datepicker-today-ring:\s*var\(--weave-color-accent\)/.test(cssTheme));
check('theme emits datepicker panel-width literal (236px)', /--weave-datepicker-panel-width:\s*236px/.test(cssTheme));
const cssDpOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.datepicker-overrides((panel-width: 280px, elevation: 1px));`,
);
check('datepicker-overrides changes existing token', /--weave-datepicker-panel-width:\s*280px/.test(cssDpOverride));
check('datepicker-overrides adds new token (auto-var)', /--weave-datepicker-elevation:\s*1px/.test(cssDpOverride));

/* ── timepicker built-in: cascade refs + spinner tokens + overrides (U4) ── */
check('theme emits timepicker spinner column width + focus ref', /--weave-timepicker-col-width:\s*42px/.test(cssTheme) && /--weave-timepicker-focus:\s*var\(--weave-color-accent\)/.test(cssTheme));
const cssTpOverride = compile(
  `@use '@weave-framework/ui' as weave;\n@include weave.timepicker-overrides((col-width: 50px, elevation: 1px));`,
);
check('timepicker-overrides changes existing token', /--weave-timepicker-col-width:\s*50px/.test(cssTpOverride));
check('timepicker-overrides adds new token (auto-var)', /--weave-timepicker-elevation:\s*1px/.test(cssTpOverride));

/* ── all-styles(): structural CSS by class ── */
const cssStyles = compile(`@use '@weave-framework/ui' as weave;\n@include weave.all-styles();`);
check('all-styles emits .weave-divider rule', /\.weave-divider\s*{/.test(cssStyles));
check('divider rule consumes its token', /var\(--weave-divider-line\)/.test(cssStyles));
check('all-styles emits .weave-ripple rule', /\.weave-ripple\s*{/.test(cssStyles));
check('all-styles emits ripple keyframes', /@keyframes\s+weave-ripple/.test(cssStyles));
check('all-styles emits .weave-icon rule', /\.weave-icon\s*{/.test(cssStyles));
check('icon rule consumes its stroke token', /stroke-width:\s*var\(--weave-icon-stroke\)/.test(cssStyles));
check('all-styles emits .weave-button rule', /\.weave-button\s*{/.test(cssStyles));
check('button rule consumes its background token', /background:\s*var\(--weave-button-background\)/.test(cssStyles));
check('button emits a --variant modifier rule', /\.weave-button--outline\s*{/.test(cssStyles));
check('all-styles emits .weave-button-toggle rule', /\.weave-button-toggle\s*{/.test(cssStyles));
check('button-toggle styles the selected segment via [aria-checked]', /\.weave-button-toggle__segment\[aria-checked=true\]/.test(cssStyles));
check('all-styles emits .weave-badge rule', /\.weave-badge\s*{/.test(cssStyles));
check('badge mark consumes its background token', /\.weave-badge__mark[\s\S]*?background:\s*var\(--weave-badge-background\)/.test(cssStyles));
check('badge emits the --dot variant rule', /\.weave-badge--dot\s+\.weave-badge__mark/.test(cssStyles));
check('all-styles emits .weave-card rule', /\.weave-card\s*{/.test(cssStyles));
check('card consumes its surface + border tokens', /\.weave-card\s*{[\s\S]*?background:\s*var\(--weave-card-background\)[\s\S]*?border:\s*1px solid var\(--weave-card-border\)/.test(cssStyles));
check('card emits its __title / __actions part rules', /\.weave-card__title\s*{/.test(cssStyles) && /\.weave-card__actions\s*{/.test(cssStyles));
check('card actions pin to the bottom (margin-top:auto)', /\.weave-card__actions\s*{[^}]*margin-top:\s*auto/.test(cssStyles));
check('all-styles emits .weave-toolbar rule', /\.weave-toolbar\s*{/.test(cssStyles));
check('toolbar consumes height + bottom rule tokens', /\.weave-toolbar\s*{[\s\S]*?height:\s*var\(--weave-toolbar-height\)[\s\S]*?border-bottom:\s*1px solid var\(--weave-toolbar-border\)/.test(cssStyles));
check('toolbar emits --ink + __spacer rules', /\.weave-toolbar--ink\s*{/.test(cssStyles) && /\.weave-toolbar__spacer\s*{[^}]*flex:\s*1/.test(cssStyles));
check('all-styles emits .weave-list rule', /\.weave-list\s*{/.test(cssStyles));
check('list styles the selected row via [aria-selected] (accentSoft + accent marker)', /\.weave-list__row\[aria-selected=true\]\s*{[\s\S]*?background:\s*var\(--weave-list-selected-background\)[\s\S]*?border-left-color:\s*var\(--weave-list-selected-marker\)/.test(cssStyles));
check('list interactivity is scoped to the listbox role', /\.weave-list\[role=listbox\]\s+\.weave-list__row:hover/.test(cssStyles));
check('all-styles emits .weave-grid-list rule (auto-fill grid)', /\.weave-grid-list\s*{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(var\(--weave-grid-list-min-tile\), 1fr\)\)/.test(cssStyles));
check('grid-list tile is a square (aspect-ratio:1)', /\.weave-grid-list__tile\s*{[\s\S]*?aspect-ratio:\s*1/.test(cssStyles));
check('grid-list emits the --accent tile modifier', /\.weave-grid-list__tile--accent\s*{[^}]*background:\s*var\(--weave-grid-list-accent-background\)/.test(cssStyles));
check('all-styles emits .weave-progress-bar rule', /\.weave-progress-bar\s*{[\s\S]*?height:\s*var\(--weave-progress-bar-height\)/.test(cssStyles));
check('progress-bar fill consumes its accent token', /\.weave-progress-bar__fill\s*{[\s\S]*?background:\s*var\(--weave-progress-bar-fill\)/.test(cssStyles));
check('progress-bar emits the --indeterminate animation + keyframes', /\.weave-progress-bar--indeterminate\s+\.weave-progress-bar__fill\s*{[\s\S]*?animation:\s*weave-progress-bar-indet/.test(cssStyles) && /@keyframes\s+weave-progress-bar-indet/.test(cssStyles));
check('all-styles emits .weave-progress-spinner ring (border-radius:50% + spin)', /\.weave-progress-spinner\s*{[\s\S]*?border-radius:\s*50%[\s\S]*?animation:\s*weave-progress-spinner-spin/.test(cssStyles) && /@keyframes\s+weave-progress-spinner-spin/.test(cssStyles));
check('progress-spinner emits the --small size modifier', /\.weave-progress-spinner--small\s*{[^}]*width:\s*var\(--weave-progress-spinner-diameter-small\)/.test(cssStyles));
check('all-styles emits .weave-checkbox + __box rules', /\.weave-checkbox\s*{/.test(cssStyles) && /\.weave-checkbox__box\s*{[\s\S]*?border:\s*var\(--weave-checkbox-border-width\)/.test(cssStyles));
check('checkbox paints the box from the native :checked pseudo (no state class)', /\.weave-checkbox__input:checked\s*\+\s*\.weave-checkbox__box[\s\S]*?background:\s*var\(--weave-checkbox-checked-background\)/.test(cssStyles));
check('checkbox styles the tri-state :indeterminate mark', /\.weave-checkbox__input:indeterminate\s*\+\s*\.weave-checkbox__box::before\s*{[^}]*opacity:\s*1/.test(cssStyles));
check('all-styles emits .weave-radio-group + circular __box rules', /\.weave-radio-group\s*{/.test(cssStyles) && /\.weave-radio__box\s*{[\s\S]*?border-radius:\s*50%/.test(cssStyles));
check('radio reveals the dot from the native :checked pseudo (no state class)', /\.weave-radio__input:checked\s*\+\s*\.weave-radio__box::after\s*{[\s\S]*?scale\(1\)/.test(cssStyles));
check('all-styles emits .weave-slide-toggle__track + knob rules', /\.weave-slide-toggle__track\s*{[\s\S]*?width:\s*var\(--weave-slide-toggle-track-width\)/.test(cssStyles) && /\.weave-slide-toggle__track::after\s*{/.test(cssStyles));
check('slide-toggle slides the knob + swaps the track on :checked (no state class)', /\.weave-slide-toggle__input:checked\s*\+\s*\.weave-slide-toggle__track\s*{[^}]*background:\s*var\(--weave-slide-toggle-track-on\)/.test(cssStyles) && /\.weave-slide-toggle__input:checked\s*\+\s*\.weave-slide-toggle__track::after\s*{[\s\S]*?translatex/.test(cssStyles));
check('all-styles emits .weave-form-field label + error rules', /\.weave-form-field__label\s*{[\s\S]*?text-transform:\s*uppercase/.test(cssStyles) && /\.weave-form-field__error\s*{[^}]*color:\s*var\(--weave-form-field-error\)/.test(cssStyles));
check('form-field reddens the label in the --invalid state', /\.weave-form-field--invalid\s+\.weave-form-field__label\s*{[^}]*color:\s*var\(--weave-form-field-error\)/.test(cssStyles));
check('all-styles emits .weave-input underline field', /\.weave-input\s*{[\s\S]*?border-bottom:\s*var\(--weave-input-border-width\)\s*solid\s*var\(--weave-input-border\)/.test(cssStyles));
check('input focus swaps the underline to accent', /\.weave-input:focus-within\s*{[\s\S]*?border-bottom-color:\s*var\(--weave-input-focus\)/.test(cssStyles));
check('input --invalid reddens the underline; empty prefix/suffix collapse', /\.weave-input--invalid\s*{[^}]*border-bottom-color:\s*var\(--weave-input-error\)/.test(cssStyles) && /\.weave-input__prefix--empty[\s\S]*?display:\s*none/.test(cssStyles));
check('input suppresses native number spinners + search clear', /::-webkit-inner-spin-button/.test(cssStyles) && /\[type=number\]\s*{[\s\S]*?appearance:\s*textfield/.test(cssStyles) && /::-webkit-search-cancel-button/.test(cssStyles));
check('all-styles emits .weave-chips chip + remove rules', /\.weave-chips__chip\s*{[\s\S]*?border:\s*1px solid var\(--weave-chips-border\)/.test(cssStyles) && /\.weave-chips__remove\s*{/.test(cssStyles));
check('chips emits the dashed --add chip', /\.weave-chips__chip--add\s*{[^}]*border-style:\s*dashed/.test(cssStyles));
check('all-styles emits the overlay backdrop scrim + transparent click-catcher', /\.weave-overlay-backdrop\s*{[^}]*background:\s*var\(--weave-overlay-backdrop\)/.test(cssStyles) && /\.weave-overlay-backdrop--transparent\s*{[^}]*background:\s*transparent/.test(cssStyles));
check('all-styles emits the hairline overlay panel (no shadow: 1px line + surface)', /\.weave-overlay-panel\s*{[\s\S]*?background:\s*var\(--weave-overlay-surface\)[\s\S]*?border:\s*1px solid var\(--weave-overlay-line\)/.test(cssStyles) && !/\.weave-overlay-panel\s*{[^}]*box-shadow/.test(cssStyles));
check('all-styles emits .weave-tooltip bubble (non-interactive + fade-in keyframes)', /\.weave-tooltip\s*{[\s\S]*?pointer-events:\s*none[\s\S]*?background:\s*var\(--weave-tooltip-background\)/.test(cssStyles) && /@keyframes\s+weave-tooltip-in/.test(cssStyles));
check('all-styles emits .weave-menu panel (overlay-panel chrome) + __item + __divider', /\.weave-menu\s*{[\s\S]*?background:\s*var\(--weave-overlay-surface\)[\s\S]*?border:\s*1px solid var\(--weave-overlay-line\)/.test(cssStyles) && /\.weave-menu__item\s*{/.test(cssStyles) && /\.weave-menu__divider\s*{/.test(cssStyles));
check('menu item hover/focus tint comes from native pseudos, excluding disabled', /\.weave-menu__item:not\(:disabled\):hover,\s*\.weave-menu__item:focus\s*{[^}]*background:\s*var\(--weave-menu-item-hover\)/.test(cssStyles));
check('menu row supports a lighter __description subtext', /\.weave-menu__description\s*{[\s\S]*?color:\s*var\(--weave-menu-item-description\)/.test(cssStyles));
check('all-styles emits .weave-dialog flex-column panel clamped to the viewport', /\.weave-dialog\s*{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column[\s\S]*?max-width:\s*calc\(100vw - 2 \* var\(--weave-dialog-margin\)\)[\s\S]*?max-height:\s*calc\(100vh - 2 \* var\(--weave-dialog-margin\)\)/.test(cssStyles));
check('dialog content is the scroll region (flex:1, min-height:0, overflow-y:auto)', /\.weave-dialog__content\s*{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/.test(cssStyles));
check('dialog header + actions are fixed (flex:0 0 auto) with dividers', /\.weave-dialog__header\s*{[\s\S]*?flex:\s*0 0 auto[\s\S]*?border-bottom:\s*1px solid var\(--weave-dialog-line\)/.test(cssStyles) && /\.weave-dialog__actions\s*{[\s\S]*?flex:\s*0 0 auto[\s\S]*?border-top:\s*1px solid var\(--weave-dialog-line\)/.test(cssStyles));
check('all-styles emits .weave-bottom-sheet (top-only radius + slide-up keyframes)', /\.weave-bottom-sheet\s*{[\s\S]*?border-radius:\s*var\(--weave-bottom-sheet-radius\)\s*var\(--weave-bottom-sheet-radius\)\s*0\s*0/.test(cssStyles) && /@keyframes\s+weave-bottom-sheet-in/.test(cssStyles));
check('bottom-sheet content scrolls (flex:1, min-height:0, overflow-y:auto)', /\.weave-bottom-sheet__content\s*{[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/.test(cssStyles));
check('all-styles emits .weave-snackbar inverted bar (ink bg) + slide-in keyframes', /\.weave-snackbar\s*{[\s\S]*?background:\s*var\(--weave-snackbar-background\)/.test(cssStyles) && /@keyframes\s+weave-snackbar-in/.test(cssStyles));
check('snackbar action is an accent text button', /\.weave-snackbar__action\s*{[\s\S]*?color:\s*var\(--weave-snackbar-action\)/.test(cssStyles));
check('select field uses the shared field-underline (same as Input) + focus accent', /\.weave-select__field\s*{[\s\S]*?border-bottom:\s*var\(--weave-select-border-width\)\s*solid\s*var\(--weave-select-border\)/.test(cssStyles) && /\.weave-select__field:focus[\s\S]*?border-bottom-color:\s*var\(--weave-select-focus\)/.test(cssStyles));
check('select panel reuses the overlay-panel chrome + scrolls', /\.weave-select__panel\s*{[\s\S]*?background:\s*var\(--weave-overlay-surface\)[\s\S]*?max-height:\s*var\(--weave-select-panel-max-height\)[\s\S]*?overflow-y:\s*auto/.test(cssStyles));
check('select option selected tint + check-mark', /\.weave-select__option--selected\s*{[^}]*background:\s*var\(--weave-select-option-selected\)/.test(cssStyles) && /\.weave-select__option--selected::after\s*{/.test(cssStyles));
check('autocomplete field IS the composed Input (no re-created field rules)', !/\.weave-autocomplete__field\s*{/.test(cssStyles) && !/\.weave-autocomplete\s*{[^}]*border-bottom/.test(cssStyles));
check('autocomplete panel reuses overlay-panel chrome + scrolls + active option + empty row', /\.weave-autocomplete__panel\s*{[\s\S]*?background:\s*var\(--weave-overlay-surface\)[\s\S]*?overflow-y:\s*auto/.test(cssStyles) && /\.weave-autocomplete__option--active\s*{[^}]*background:\s*var\(--weave-autocomplete-option-hover\)/.test(cssStyles) && /\.weave-autocomplete__empty\s*{/.test(cssStyles));
check('all-styles emits .weave-expansion accordion (1px border + header)', /\.weave-expansion\s*{[\s\S]*?border:\s*1px solid var\(--weave-expansion-divider\)/.test(cssStyles) && /\.weave-expansion__header\s*{/.test(cssStyles));
check('expansion tints the open header via [aria-expanded] (no state class)', /\.weave-expansion__header\[aria-expanded=true\]\s*{[^}]*background:\s*var\(--weave-expansion-header-open-background\)/.test(cssStyles));
check('expansion marker flips +→− off aria-expanded', /\.weave-expansion__marker::after\s*{[^}]*content:\s*["']\+["']/.test(cssStyles) && /\.weave-expansion__header\[aria-expanded=true\]\s+\.weave-expansion__marker::after\s*{/.test(cssStyles));
check('expansion region reveals via grid-template-rows 0fr→1fr', /\.weave-expansion__region\s*{[\s\S]*?grid-template-rows:\s*0fr/.test(cssStyles) && /\.weave-expansion__region\[data-open=true\]\s*{[^}]*grid-template-rows:\s*1fr/.test(cssStyles));
check('all-styles emits .weave-tabs list over a 1px rule', /\.weave-tabs__list\s*{[\s\S]*?border-bottom:\s*1px solid var\(--weave-tabs-line\)/.test(cssStyles));
check('tabs active tab inks + paints the accent square (no sliding underline)', /\.weave-tabs__tab\[aria-selected=true\]\s*{[^}]*color:\s*var\(--weave-tabs-text-active\)/.test(cssStyles) && /\.weave-tabs__tab\[aria-selected=true\]::before\s*{[^}]*background:\s*var\(--weave-tabs-marker\)/.test(cssStyles));
check('tabs reserves the marker square space on every tab (::before)', /\.weave-tabs__tab::before\s*{[\s\S]*?width:\s*var\(--weave-tabs-marker-size\)[\s\S]*?background:\s*transparent/.test(cssStyles));
check('all-styles emits .weave-stepper circular indicator', /\.weave-stepper__indicator\s*{[\s\S]*?border-radius:\s*50%/.test(cssStyles));
check('stepper paints states via [data-state]: active/done accent fill, upcoming bordered', /\.weave-stepper__step\[data-state=active\]\s+\.weave-stepper__indicator\s*{[^}]*background:\s*var\(--weave-stepper-active-background\)/.test(cssStyles) && /\.weave-stepper__step\[data-state=upcoming\]\s+\.weave-stepper__indicator\s*{[^}]*border:\s*var\(--weave-stepper-border-width\)/.test(cssStyles));
check('stepper done step shows a pure-CSS ✓ (rotated-L) + hides the number', /\.weave-stepper__step\[data-state=done\]\s+\.weave-stepper__number\s*{[^}]*display:\s*none/.test(cssStyles) && /\.weave-stepper__step\[data-state=done\]\s+\.weave-stepper__indicator::after\s*{[\s\S]*?transform:\s*rotate\(45deg\)/.test(cssStyles));
check('stepper connector goes accent once its step is done', /\.weave-stepper__connector\[data-state=done\]\s*{[^}]*background:\s*var\(--weave-stepper-connector-done\)/.test(cssStyles));
check('stepper label truncates so the header never overflows its box', /\.weave-stepper__label\s*{[\s\S]*?min-width:\s*0[\s\S]*?text-overflow:\s*ellipsis/.test(cssStyles) && /\.weave-stepper__step\s*{[\s\S]*?min-width:\s*0/.test(cssStyles));
check('all-styles emits .weave-slider track + accent fill', /\.weave-slider__track\s*{[\s\S]*?height:\s*var\(--weave-slider-track-height\)[\s\S]*?background:\s*var\(--weave-slider-track\)/.test(cssStyles) && /\.weave-slider__fill\s*{[\s\S]*?background:\s*var\(--weave-slider-fill\)/.test(cssStyles));
check('slider thumb is a 3×18 ink bar with a 5px accent cap (::after)', /\.weave-slider__thumb\s*{[\s\S]*?width:\s*var\(--weave-slider-thumb-width\)[\s\S]*?height:\s*var\(--weave-slider-thumb-height\)[\s\S]*?background:\s*var\(--weave-slider-thumb\)/.test(cssStyles) && /\.weave-slider__thumb::after\s*{[\s\S]*?background:\s*var\(--weave-slider-cap\)/.test(cssStyles));
check('slider blocks page scroll during a pointer drag (touch-action:none)', /\.weave-slider\s*{[\s\S]*?touch-action:\s*none/.test(cssStyles));
check('slider focus shows on the thumb (ring), not a box around the track', /\.weave-slider:focus-visible\s*{[^}]*outline:\s*none/.test(cssStyles) && /\.weave-slider:focus-visible\s+\.weave-slider__thumb\s*{[^}]*outline:\s*2px solid/.test(cssStyles));
check('all-styles emits .weave-paginator page + nav buttons', /\.weave-paginator__page,\s*\.weave-paginator__nav\s*{[\s\S]*?min-width:\s*var\(--weave-paginator-button\)/.test(cssStyles));
check('paginator page/nav buttons ARE Button (only compact sizing here, no re-created fill)', /\.weave-paginator__page,\s*\.weave-paginator__nav\s*{[^}]*min-width:\s*var\(--weave-paginator-button\)/.test(cssStyles) && !/\.weave-paginator__page\[aria-current=page\]/.test(cssStyles));
check('paginator emits the ellipsis + tabular-nums range; jump field IS the composed Input (width only)', /\.weave-paginator__ellipsis\s*{/.test(cssStyles) && /\.weave-paginator__range\s*{[\s\S]*?font-variant-numeric:\s*tabular-nums/.test(cssStyles) && /\.weave-paginator__jump-field\s*{[^}]*width:\s*var\(--weave-paginator-jump-width\)/.test(cssStyles) && !/\.weave-paginator__jump-input\s*{/.test(cssStyles));

/* ── sidenav (U4 Phase B): drawer + content + backdrop shell, mode modifiers ── */
check('all-styles emits .weave-sidenav shell (relative flex, drawer + content)', /\.weave-sidenav\s*{[\s\S]*?position:\s*relative[\s\S]*?display:\s*flex/.test(cssStyles) && /\.weave-sidenav__drawer\s*{[\s\S]*?width:\s*var\(--weave-sidenav-width\)/.test(cssStyles) && /\.weave-sidenav__content\s*{/.test(cssStyles));
check('sidenav backdrop scrim consumes the (overlay-reused) token + toggles on --backdrop', /\.weave-sidenav__backdrop\s*{[\s\S]*?background:\s*var\(--weave-sidenav-backdrop\)[\s\S]*?pointer-events:\s*none/.test(cssStyles) && /\.weave-sidenav--backdrop\s*\.weave-sidenav__backdrop\s*{[\s\S]*?opacity:\s*1/.test(cssStyles));
check('sidenav emits the three mode modifiers (side pushes / over floats via transform)', /\.weave-sidenav--side:not\(\.weave-sidenav--opened\)\s*\.weave-sidenav__drawer\s*{[\s\S]*?margin-inline-start:\s*calc\(-1 \* var\(--weave-sidenav-width\)\)/.test(cssStyles) && /\.weave-sidenav--over\s*\.weave-sidenav__drawer[\s\S]*?transform:\s*translatex\(-100%\)/.test(cssStyles) && /\.weave-sidenav--push\.weave-sidenav--opened\s*\.weave-sidenav__content\s*{[\s\S]*?margin-inline-start:\s*var\(--weave-sidenav-width\)/.test(cssStyles));

/* ── table (U4 §4.9): real <table> grid, sticky header, hairline rows, selection mark ── */
check('all-styles emits .weave-table grid (separate borders, scroll box)', /\.weave-table__scroll\s*{[\s\S]*?overflow:\s*auto/.test(cssStyles) && /\.weave-table__grid\s*{[\s\S]*?border-collapse:\s*separate/.test(cssStyles));
check('table header cell is sticky-top with a hairline (no shadow)', /\.weave-table__header-cell\s*{[\s\S]*?position:\s*sticky[\s\S]*?top:\s*0[\s\S]*?box-shadow:\s*0 1px 0 var\(--weave-table-line\)/.test(cssStyles));
check('table body cell = hairline row separator + numeric tabular-nums', /\.weave-table__cell\s*{[\s\S]*?box-shadow:\s*0 -1px 0 var\(--weave-table-line\)/.test(cssStyles) && /\.weave-table__cell--numeric\s*{[\s\S]*?font-variant-numeric:\s*tabular-nums/.test(cssStyles));
check('table selected row = accentSoft tint + 2px accent left border (via [aria-selected])', /\.weave-table__row\[aria-selected=true\]\s*>\s*\.weave-table__cell\s*{[\s\S]*?background:\s*var\(--weave-table-selected-background\)/.test(cssStyles) && /\.weave-table__row\[aria-selected=true\]\s*>\s*\.weave-table__cell:first-child\s*{[\s\S]*?border-left-color:\s*var\(--weave-table-selected-marker\)/.test(cssStyles));
check('table sticky columns are position:sticky; expand chevron rotates on [aria-expanded]', /\.weave-table__cell--sticky-start,\s*\.weave-table__cell--sticky-end\s*{[\s\S]*?position:\s*sticky/.test(cssStyles) && /\.weave-table__expand-toggle\[aria-expanded=true\]::before\s*{[\s\S]*?transform:\s*rotate\(90deg\)/.test(cssStyles));
check('table resize grip = col-resize hairline lighting to accent on hover/focus (U5)', /\.weave-table__resize-grip\s*{[\s\S]*?cursor:\s*col-resize[\s\S]*?touch-action:\s*none/.test(cssStyles) && /\.weave-table__resize-grip:hover::after,\s*\.weave-table__resize-grip:focus-visible::after\s*{[\s\S]*?background:\s*var\(--weave-table-resize-grip-active\)/.test(cssStyles));

/* ── tree (U4 §4.10): indented treeitem rows, rotating ▸ marker, accent selection mark ── */
check('all-styles emits .weave-tree node indented by depth (indent × --weave-tree-depth)', /\.weave-tree__node\s*{[\s\S]*?padding-inline-start:\s*calc\(\s*var\(--weave-tree-node-padding-x\)\s*\+\s*var\(--weave-tree-indent\)\s*\*\s*var\(--weave-tree-depth,\s*0\)\s*\)/.test(cssStyles));
check('tree disclosure marker rotates on [aria-expanded]', /\.weave-tree__toggle::before\s*{[\s\S]*?content:\s*["']▸["']/.test(cssStyles) && /\.weave-tree__node\[aria-expanded=true\]\s*\.weave-tree__toggle::before\s*{[\s\S]*?transform:\s*rotate\(90deg\)/.test(cssStyles));
check('tree selected node = accentSoft tint + 2px accent left border (via [aria-selected])', /\.weave-tree__node\[aria-selected=true\]\s*{[\s\S]*?background:\s*var\(--weave-tree-selected-background\)[\s\S]*?border-inline-start-color:\s*var\(--weave-tree-selected-marker\)/.test(cssStyles));

/* ── datepicker (U4 §4.13): underline field + calendar grid, selected fill, today ring ── */
check('all-styles emits .weave-datepicker field (shared underline) + calendar panel (overlay chrome)', /\.weave-datepicker__field\s*{[\s\S]*?border-bottom:\s*var\(--weave-datepicker-border-width\)/.test(cssStyles) && /\.weave-datepicker__panel\s*{[\s\S]*?width:\s*var\(--weave-datepicker-panel-width\)/.test(cssStyles));
check('datepicker selected day = accent fill + white; today = inset accent ring', /\.weave-datepicker__cell--selected\s*{[\s\S]*?background:\s*var\(--weave-datepicker-selected-background\)[\s\S]*?color:\s*var\(--weave-datepicker-selected-text\)/.test(cssStyles) && /\.weave-datepicker__cell--today\s*{[\s\S]*?box-shadow:\s*inset 0 0 0 1px var\(--weave-datepicker-today-ring\)/.test(cssStyles));
check('datepicker editable input strips its own chrome (shares the field underline) + icon toggle button', /\.weave-datepicker__input\s*{[\s\S]*?flex:\s*1 1 auto/.test(cssStyles) && /\.weave-datepicker__icon-button\s*{/.test(cssStyles));

/* ── tree reorder drag handle (U4 retrofit via CDK dropList) ── */
check('tree emits a reorder drag handle (grab cursor, touch-action:none)', /\.weave-tree__drag-handle\s*{[\s\S]*?color:\s*var\(--weave-tree-drag-handle\)[\s\S]*?cursor:\s*grab[\s\S]*?touch-action:\s*none/.test(cssStyles));

/* ── menubar (U5 §5.2): top bar items, open item tinted via [aria-expanded] ── */
check('all-styles emits .weave-menubar bar + item (open item tinted via [aria-expanded])', /\.weave-menubar\s*{[\s\S]*?display:\s*flex/.test(cssStyles) && /\.weave-menubar__item\[aria-expanded=true\]\s*{[\s\S]*?background:\s*var\(--weave-menubar-item-open\)/.test(cssStyles));

/* ── list reorder drag handle (U4 retrofit via CDK dropList) ── */
check('list emits a reorder drag handle (grab cursor, touch-action:none)', /\.weave-list__drag-handle\s*{[\s\S]*?color:\s*var\(--weave-list-drag-handle\)[\s\S]*?cursor:\s*grab[\s\S]*?touch-action:\s*none/.test(cssStyles));

/* ── bottom-sheet drag-to-dismiss handle (U4 retrofit via CDK Drag&Drop) ── */
check('bottom-sheet emits a drag-to-dismiss grab handle (touch-action:none)', /\.weave-bottom-sheet__handle\s*{[\s\S]*?background:\s*var\(--weave-bottom-sheet-handle\)[\s\S]*?touch-action:\s*none/.test(cssStyles));

/* ── timepicker (U4 §4.14): underline field + spinner columns (▲/▼) + AM/PM toggle ── */
check('all-styles emits .weave-timepicker field (shared underline) + spinner panel (overlay chrome, flex row)', /\.weave-timepicker__field\s*{[\s\S]*?border-bottom:\s*var\(--weave-timepicker-border-width\)/.test(cssStyles) && /\.weave-timepicker__panel\s*{[\s\S]*?display:\s*flex/.test(cssStyles));
check('timepicker spinner column is a stacked ▲/value/▼ with tabular-nums value + AM/PM toggle', /\.weave-timepicker__col\s*{[\s\S]*?flex-direction:\s*column/.test(cssStyles) && /\.weave-timepicker__col-value\s*{[\s\S]*?font-variant-numeric:\s*tabular-nums/.test(cssStyles) && /\.weave-timepicker__ampm\s*{/.test(cssStyles));

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
