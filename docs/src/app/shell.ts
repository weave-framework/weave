import { signal } from '@weave/runtime';
import { RouterView, Link, currentPath, type Router } from '@weave/router';
import { sections, type NavSection, type NavGroup } from '../nav';
import { router } from './router';
import SearchBox from '../lib/search/search-box';

interface ShellSetup {
  router: Router;
  sections: NavSection[];
  /** Sidebar groups for whichever section the current path falls under. */
  groups: () => NavGroup[];
  /** The section currently active (drives the top-bar highlight + sidebar). */
  isSection: (s: NavSection) => boolean;
  theme: () => 'dark' | 'light';
  toggleTheme: () => void;
  themeIcon: () => string;
  repoUrl: string;
}

// Capitalized tags in shell.html resolve to these imports.
void RouterView;
void Link;
void SearchBox;

/** Root shell: top bar (logo + section switcher + search + theme) and a sidebar
 *  whose groups follow the active section, around the routed content. */
export function setup(): ShellSetup {
  const current = (): NavSection =>
    sections.find((s) => currentPath().startsWith(s.basePath)) ?? sections[0];

  const groups = (): NavGroup[] => current().groups;
  const isSection = (s: NavSection): boolean => current().id === s.id;

  const theme = signal<'dark' | 'light'>('dark');
  const toggleTheme = (): void => {
    theme.set((t) => (t === 'dark' ? 'light' : 'dark'));
    document.documentElement.dataset.theme = theme();
  };
  const themeIcon = (): string => (theme() === 'dark' ? '☀' : '☾');

  return {
    router,
    sections,
    groups,
    isSection,
    theme,
    toggleTheme,
    themeIcon,
    repoUrl: 'https://github.com/aidasjosas/weave',
  };
}
