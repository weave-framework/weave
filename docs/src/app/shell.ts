import { signal } from '@weave-framework/runtime';
import { RouterView, Link, navigate, currentPath, type Router } from '@weave-framework/router';
import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Icon from '@weave-framework/ui/icon';
import Sidenav, { type SidenavApi } from '@weave-framework/ui/sidenav';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import { sections, type NavSection, type NavGroup } from '../nav';
import { router } from './router';
import SearchBox from '../lib/search/search-box';

interface ShellSetup {
  router: Router;
  /** Sidebar groups for whichever section the current path falls under. */
  groups: () => NavGroup[];
  /** Section switcher options for the top-bar `<ButtonToggle>` (id → icon + labelled segment). */
  sectionOptions: { value: string; label: string; icon: string }[];
  /** The id of the section the current path falls under (drives the switcher's selected segment). */
  activeSectionId: () => string;
  /** Navigate to a section's landing route when its switcher segment is chosen. */
  goToSection: (id: string | string[]) => void;
  toggleTheme: () => void;
  /** Icon name for the theme button — `sun` in dark mode, `moon` in light. */
  themeIconName: () => string;
  /** Open the repository in a new tab (the GitHub icon button). */
  openRepo: () => void;
  /** Receives the Sidenav's imperative handle so the top-bar hamburger can toggle the drawer. */
  setNavApi: (api: SidenavApi) => void;
  /** Toggle the responsive drawer (narrow screens). */
  toggleNav: () => void;
  repoUrl: string;
}

// Capitalized tags in shell.html resolve to these imports.
void RouterView;
void Link;
void Toolbar;
void Button;
void Icon;
void Sidenav;
void ButtonToggle;
void SearchBox;

const repoUrl: string = 'https://github.com/weave-framework/weave';

/** Root shell: a Weave-UI `<Toolbar>` (brand + section `<ButtonToggle>` + search + theme/GitHub
 *  `<Button>`s) over a responsive `<Sidenav>` whose drawer holds the section's sidebar and whose
 *  content pane hosts the routed page. */
export function setup(): ShellSetup {
  const current = (): NavSection =>
    sections.find((s) => currentPath().startsWith(s.basePath)) ?? sections[0];

  const groups = (): NavGroup[] => current().groups;

  const sectionOptions = sections.map((s) => ({ value: s.id, label: s.label, icon: s.icon }));
  const activeSectionId = (): string => current().id;
  const goToSection = (id: string | string[]): void => {
    const key: string = Array.isArray(id) ? id[0] : id;
    const section: NavSection | undefined = sections.find((s) => s.id === key);
    if (section) navigate(section.home);
  };

  const theme = signal<'dark' | 'light'>('light');
  const toggleTheme = (): void => {
    theme.set((t) => (t === 'dark' ? 'light' : 'dark'));
    document.documentElement.dataset.theme = theme();
  };
  const themeIconName = (): string => (theme() === 'dark' ? 'sun' : 'moon');

  const openRepo = (): void => {
    window.open(repoUrl, '_blank', 'noopener,noreferrer');
  };

  let navApi: SidenavApi | undefined;
  const setNavApi = (api: SidenavApi): void => {
    navApi = api;
  };
  const toggleNav = (): void => navApi?.toggle();

  return {
    router,
    groups,
    sectionOptions,
    activeSectionId,
    goToSection,
    toggleTheme,
    themeIconName,
    openRepo,
    setNavApi,
    toggleNav,
    repoUrl,
  };
}
