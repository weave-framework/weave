/**
 * Docs icon registration. The chrome uses a few glyphs beyond the built-in Lucide
 * 46-set that `@weave-framework/ui/icon` ships (theme sun/moon, GitHub, copy), so we
 * register them once here via the Icon registry's `inlineIcons` source. Importing this
 * module for its side effect (from the shell, before any `<Icon>` renders) makes the
 * names resolvable through the same registry a consumer would configure.
 *
 * Inner geometry only — the registry's `normalize()` wraps it in the standard Weave
 * `<svg viewBox="0 0 24 24" stroke="currentColor" …>`. Paths are the Lucide originals.
 */
import { configureIcons, inlineIcons } from '@weave-framework/ui/icon';

const extraIcons: Record<string, string> = {
  // Theme toggle — sun (shown in dark mode) / moon (shown in light mode).
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>' +
    '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>' +
    '<path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/>' +
    '<path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  // Repository link.
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5' +
    '.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C4 2 3 2 3 2c-.28 ' +
    '1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 2 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05' +
    '-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  // Copy-to-clipboard (code blocks).
  copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};

// Register globally (keeps the built-in Lucide set as the fallback source).
configureIcons({ sources: [inlineIcons(extraIcons)] });
