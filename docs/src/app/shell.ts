import { signal, effect } from '@weave-framework/runtime';
import { RouterView, Link, navigate, currentPath, type Router } from '@weave-framework/router';
import { scrollToHash } from '../lib/util/scroll';
import Toolbar from '@weave-framework/ui/toolbar';
import Button from '@weave-framework/ui/button';
import Badge from '@weave-framework/ui/badge';
import Icon from '@weave-framework/ui/icon';
import Sidenav, { type SidenavApi } from '@weave-framework/ui/sidenav';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Expansion, { type ExpansionPanel } from '@weave-framework/ui/expansion';
import { sections, type NavSection, type NavGroup, type NavItem } from '../nav';
import { router } from './router';
import SearchBox from '../lib/search/search-box';

interface ShellSetup {
  router: Router;
  /** A stable key for the sidebar accordion — re-mounts `<Expansion>` on a section change so
   *  its (append-once) panel bodies rebuild for the new section. */
  sidebarKey: () => string[];
  /** The current section's groups as Expansion panels (body = the group's real `<Link>`s). */
  sidebarPanels: () => ExpansionPanel[];
  /** Every group id — the accordion's default-open set (all groups expanded initially). */
  sidebarOpenIds: () => string[];
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
void Badge;
void Icon;
void Sidenav;
void ButtonToggle;
void Expansion;
void SearchBox;

const repoUrl: string = 'https://github.com/weave-framework/weave';

/** Root shell: a Weave-UI `<Toolbar>` (brand + section `<ButtonToggle>` + search + theme/GitHub
 *  `<Button>`s) over a responsive `<Sidenav>` whose drawer holds the section's sidebar and whose
 *  content pane hosts the routed page. */
export function setup(): ShellSetup {
  const current = (): NavSection =>
    sections.find((s) => currentPath().startsWith(s.basePath)) ?? sections[0];

  const groups = (): NavGroup[] => current().groups;

  // Build a group's links as a Node for an Expansion body — composing the REAL router <Link>
  // (a callable component returning an <a> with navigation + active state), not a re-created link.
  const buildGroupLinks = (items: NavItem[]): Node => {
    const box: HTMLElement = document.createElement('div');
    box.className = 'nav-group-links';
    for (const it of items) {
      box.appendChild(
        Link(
          { to: it.path, class: 'nav-link', activeClass: 'active' },
          { default: () => document.createTextNode(it.label) },
        ) as Node,
      );
    }
    return box;
  };

  const sidebarKey = (): string[] => [activeSectionId()];
  const sidebarPanels = (): ExpansionPanel[] =>
    groups().map((g) => ({ id: g.label, header: g.label, body: () => buildGroupLinks(g.items) }));
  const sidebarOpenIds = (): string[] => groups().map((g) => g.label);

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

  // Route-change scroll: the content scrolls inside the Sidenav pane (not the window), so a
  // new page would otherwise stay wherever the previous one was scrolled. On a path change,
  // smooth-scroll to the URL's anchor if it has one, else ease the new page up to the top.
  effect(() => {
    currentPath(); // track route changes
    const hash: string = location.hash;
    const pane: HTMLElement | null = document.querySelector('.weave-sidenav__content');
    // Kick the smooth scroll SYNCHRONOUSLY here — this effect runs before RouterView swaps the
    // routed content, so the pane is still at the previous offset and the browser animates it
    // to the top (the animation carries on through the content swap). An anchored URL waits a
    // frame for the new page to render, then eases to the anchor.
    if (!hash) {
      pane?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    requestAnimationFrame(() => scrollToHash(hash));
  });

  return {
    router,
    sidebarKey,
    sidebarPanels,
    sidebarOpenIds,
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
