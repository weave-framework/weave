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
        { label: 'Thinking in signals', path: '/learn/signals' },
      ],
    },
    // Future groups (Components, Templates, Reactivity, Styling, Routing, Store,
    // Forms, i18n, Motion, Tooling, Recipes…) drop in here as content lands.
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
        { label: '@weave/runtime', path: '/reference/runtime' },
        { label: '@weave/router', path: '/reference/router' },
        { label: '@weave/store', path: '/reference/store' },
        { label: '@weave/forms', path: '/reference/forms' },
        { label: '@weave/i18n', path: '/reference/i18n' },
        { label: '@weave/data', path: '/reference/data' },
      ],
    },
    // @weave/cli, /check, template syntax, config — added as their pages are written.
  ],
};

/** The whole site's navigation. Add a section here to add a top-level area. */
export const sections: NavSection[] = [learn, reference];
