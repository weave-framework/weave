/**
 * The documentation navigation — a plain data model so the whole site (top-bar
 * section switcher + sidebar groups) is driven by this one structure.
 *
 * EXTENSIBLE BY DESIGN: a new top-level area (e.g. a future "Components" / Weave
 * Material library) is added by pushing one more {@link NavSection} onto
 * `sections` — the shell renders whatever is here, no layout changes needed.
 */

export interface NavItem {
  label: string;
  path: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavSection {
  /** Stable id (also the @for key). */
  id: string;
  /** Label shown in the top-bar switcher. */
  label: string;
  /** A short glyph shown next to the label. */
  icon: string;
  /** URL prefix that selects this section (and its sidebar). */
  basePath: string;
  /** Landing route for the section (where the top-bar link points). */
  home: string;
  /** Sidebar groups for this section. */
  groups: NavGroup[];
}

/** 🎓 Learn — narrative, gentle, beginner-friendly. */
const learn: NavSection = {
  id: 'learn',
  label: 'Learn',
  icon: '🎓',
  basePath: '/learn',
  home: '/learn/introduction',
  groups: [
    {
      label: 'Getting started',
      items: [
        { label: 'Introduction', path: '/learn/introduction' },
        { label: 'Why Weave?', path: '/learn/why-weave' },
        { label: 'Installation', path: '/learn/installation' },
        { label: 'Quick start', path: '/learn/quick-start' },
      ],
    },
    {
      label: 'Core concepts',
      items: [
        { label: 'Thinking in signals', path: '/learn/signals' },
        { label: 'Reactivity in depth', path: '/learn/reactivity' },
        { label: 'Components', path: '/learn/components' },
        { label: 'Templates', path: '/learn/templates' },
        { label: 'Styling', path: '/learn/styling' },
      ],
    },
    {
      label: 'Building apps',
      items: [
        { label: 'Lifecycle, context & DI', path: '/learn/lifecycle-context-di' },
        { label: 'Router', path: '/learn/router' },
        { label: 'Store', path: '/learn/store' },
        { label: 'Forms', path: '/learn/forms' },
        { label: 'Internationalization', path: '/learn/i18n' },
        { label: 'Motion', path: '/learn/motion' },
      ],
    },
    {
      label: 'Going further',
      items: [
        { label: 'Custom elements & bootstrap', path: '/learn/custom-elements' },
        { label: 'Tooling & CLI', path: '/learn/tooling' },
        { label: 'Recipes', path: '/learn/recipes' },
      ],
    },
  ],
};

/** 📖 Reference — exhaustive, per-package API. */
const reference: NavSection = {
  id: 'reference',
  label: 'Reference',
  icon: '📖',
  basePath: '/reference',
  home: '/reference/runtime',
  groups: [
    {
      label: 'Packages',
      items: [
        { label: '@weave-framework/runtime', path: '/reference/runtime' },
        { label: '@weave-framework/runtime/dom', path: '/reference/runtime-dom' },
        { label: '@weave-framework/router', path: '/reference/router' },
        { label: '@weave-framework/store', path: '/reference/store' },
        { label: '@weave-framework/forms', path: '/reference/forms' },
        { label: '@weave-framework/forms/dom', path: '/reference/forms-dom' },
        { label: '@weave-framework/i18n', path: '/reference/i18n' },
        { label: '@weave-framework/data', path: '/reference/data' },
      ],
    },
    {
      label: 'Guides',
      items: [
        { label: 'Template syntax', path: '/reference/template-syntax' },
        { label: 'Configuration', path: '/reference/config' },
      ],
    },
  ],
};

/** 📦 UI — the component library, documented exhaustively (every prop, state, and scenario).
 *  Data-driven groups; items are added as each component's page lands. */
const ui: NavSection = {
  id: 'ui',
  label: 'UI',
  icon: '📦',
  basePath: '/ui',
  home: '/ui/theming',
  groups: [
    {
      label: 'Overview',
      items: [{ label: 'Styling & theming', path: '/ui/theming' }],
    },
    {
      label: 'Foundational',
      items: [
        { label: 'Button', path: '/ui/button' },
        { label: 'Button Toggle', path: '/ui/button-toggle' },
        { label: 'Icon', path: '/ui/icon' },
        { label: 'Badge', path: '/ui/badge' },
        { label: 'Card', path: '/ui/card' },
        { label: 'Toolbar', path: '/ui/toolbar' },
        { label: 'Ripple', path: '/ui/ripple' },
        { label: 'Divider', path: '/ui/divider' },
      ],
    },
    {
      label: 'Form controls',
      items: [
        { label: 'Input', path: '/ui/input' },
        { label: 'Form Field', path: '/ui/form-field' },
        { label: 'Checkbox', path: '/ui/checkbox' },
        { label: 'Radio Group', path: '/ui/radio' },
        { label: 'Slide Toggle', path: '/ui/slide-toggle' },
        { label: 'Select', path: '/ui/select' },
        { label: 'Autocomplete', path: '/ui/autocomplete' },
        { label: 'Chips', path: '/ui/chips' },
        { label: 'Slider', path: '/ui/slider' },
      ],
    },
    {
      label: 'Pickers',
      items: [
        { label: 'Datepicker', path: '/ui/datepicker' },
        { label: 'Timepicker', path: '/ui/timepicker' },
      ],
    },
    {
      label: 'Feedback & overlays',
      items: [
        { label: 'Dialog', path: '/ui/dialog' },
        { label: 'Snackbar', path: '/ui/snackbar' },
        { label: 'Tooltip', path: '/ui/tooltip' },
        { label: 'Progress Bar', path: '/ui/progress-bar' },
        { label: 'Progress Spinner', path: '/ui/progress-spinner' },
      ],
    },
  ],
};

/** The whole site's navigation. Add a section here to add a top-level area. */
export const sections: NavSection[] = [learn, reference, ui];
