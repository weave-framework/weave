import { signal } from '@weave-framework/runtime';
import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
  open: () => string[];
  setOpen: (v: string[]) => void;
}

/** Single-open accordion (multi={{ false }}) — opening one closes the rest. */
export function setup(): Setup {
  const open = signal<string[]>(['general']);
  const panels = [
    { id: 'general', header: 'General', body: 'Language, theme and time-zone preferences.' },
    { id: 'privacy', header: 'Privacy', body: 'Who can see your profile and activity.' },
    { id: 'notifications', header: 'Notifications', body: 'Email and push alerts, per event type.' },
  ];
  return { panels, open, setOpen: (v) => open.set(v) };
}
