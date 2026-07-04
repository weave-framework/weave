import { signal, computed, effect } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Select from '@weave-framework/ui/select';
import RadioGroup from '@weave-framework/ui/radio';
import SlideToggle from '@weave-framework/ui/slide-toggle';
import Slider from '@weave-framework/ui/slider';
import Tabs from '@weave-framework/ui/tabs';
import Card from '@weave-framework/ui/card';
import Button from '@weave-framework/ui/button';
import { snackbar } from '@weave-framework/ui/snackbar';

// Capitalized tags in the template resolve to these imports.
void Input;
void Select;
void RadioGroup;
void SlideToggle;
void Slider;
void Tabs;
void Card;
void Button;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'lt', label: 'Lietuvių' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
];
const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const DENSITY = ['Compact', 'Cozy', 'Comfortable'];

const DEFAULTS = {
  name: 'Aidas',
  email: 'aidas@example.com',
  language: 'en',
  theme: 'system',
  density: 1,
  reduceMotion: false,
  emailNotif: true,
  pushNotif: false,
};

const langLabel = (v: string): string => LANGUAGES.find((l) => l.value === v)?.label ?? v;

interface Setup {
  name: () => string;
  email: () => string;
  language: () => string;
  theme: () => string;
  density: () => number;
  reduceMotion: () => boolean;
  emailNotif: () => boolean;
  pushNotif: () => boolean;
  languageOpts: typeof LANGUAGES;
  themeOpts: typeof THEMES;
  previewTabs: { label: string; content: () => Node }[];
  tab: () => number;
  densityFmt: (v: number) => string;
  setName: (v: string) => void;
  setEmail: (v: string) => void;
  setLanguage: (v: string | string[]) => void;
  setTheme: (v: string) => void;
  setDensity: (v: number) => void;
  setReduceMotion: (v: boolean) => void;
  setEmailNotif: (v: boolean) => void;
  setPushNotif: (v: boolean) => void;
  setTab: (i: number) => void;
  save: (e?: Event) => void;
  reset: () => void;
}

/** The settings panel component. */
export function setup(): Setup {
  const name = signal(DEFAULTS.name);
  const email = signal(DEFAULTS.email);
  const language = signal(DEFAULTS.language);
  const theme = signal(DEFAULTS.theme);
  const density = signal(DEFAULTS.density);
  const reduceMotion = signal(DEFAULTS.reduceMotion);
  const emailNotif = signal(DEFAULTS.emailNotif);
  const pushNotif = signal(DEFAULTS.pushNotif);
  const tab = signal(0);

  const densityFmt = (v: number): string => DENSITY[v] ?? String(v);

  // One derived object gathering the whole form — the preview reads only this.
  const settings = computed(() => ({
    name: name(),
    email: email(),
    language: language(),
    theme: theme(),
    density: densityFmt(density()),
    reduceMotion: reduceMotion(),
    emailNotif: emailNotif(),
    pushNotif: pushNotif(),
  }));

  // Two live preview panels, each a small reactive node fed to a Tabs panel.
  const summaryPanel = (): Node => {
    const dl = document.createElement('dl');
    dl.className = 'settings__summary';
    effect(() => {
      const s = settings();
      const rows: [string, string][] = [
        ['Name', s.name],
        ['Email', s.email],
        ['Language', langLabel(s.language)],
        ['Theme', s.theme],
        ['Density', s.density],
        ['Reduce motion', s.reduceMotion ? 'On' : 'Off'],
        ['Email notifications', s.emailNotif ? 'On' : 'Off'],
        ['Push notifications', s.pushNotif ? 'On' : 'Off'],
      ];
      dl.replaceChildren();
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        dl.append(dt, dd);
      }
    });
    return dl;
  };
  const jsonPanel = (): Node => {
    const pre = document.createElement('pre');
    pre.className = 'settings__json';
    effect(() => {
      pre.textContent = JSON.stringify(settings(), null, 2);
    });
    return pre;
  };

  const save = (e?: Event): void => {
    e?.preventDefault();
    snackbar('Settings saved', { action: 'Undo', duration: 3000 });
  };
  const reset = (): void => {
    name.set(DEFAULTS.name);
    email.set(DEFAULTS.email);
    language.set(DEFAULTS.language);
    theme.set(DEFAULTS.theme);
    density.set(DEFAULTS.density);
    reduceMotion.set(DEFAULTS.reduceMotion);
    emailNotif.set(DEFAULTS.emailNotif);
    pushNotif.set(DEFAULTS.pushNotif);
  };

  return {
    name,
    email,
    language,
    theme,
    density,
    reduceMotion,
    emailNotif,
    pushNotif,
    languageOpts: LANGUAGES,
    themeOpts: THEMES,
    previewTabs: [
      { label: 'Summary', content: summaryPanel },
      { label: 'JSON', content: jsonPanel },
    ],
    tab,
    densityFmt,
    setName: (v) => name.set(v),
    setEmail: (v) => email.set(v),
    setLanguage: (v) => language.set(v as string),
    setTheme: (v) => theme.set(v),
    setDensity: (v) => density.set(v),
    setReduceMotion: (v) => reduceMotion.set(v),
    setEmailNotif: (v) => emailNotif.set(v),
    setPushNotif: (v) => pushNotif.set(v),
    setTab: (i) => tab.set(i),
    save,
    reset,
  };
}
