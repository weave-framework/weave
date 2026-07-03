import { signal } from '@weave-framework/runtime';
import Menubar from '@weave-framework/ui/menubar';

// Capitalized tags in the template resolve to this import.
void Menubar;

interface Setup {
  menus: { label: string; items: { value: string; label: string }[] }[];
  picked: () => string;
  onSelect: (v: string | { value: string }) => void;
}

/** An application menubar (File / Edit / View). */
export function setup(): Setup {
  const picked = signal('');
  const menus = [
    { label: 'File', items: [{ value: 'new', label: 'New' }, { value: 'open', label: 'Open' }, { value: 'save', label: 'Save' }] },
    { label: 'Edit', items: [{ value: 'undo', label: 'Undo' }, { value: 'redo', label: 'Redo' }] },
    { label: 'View', items: [{ value: 'zoom-in', label: 'Zoom in' }, { value: 'zoom-out', label: 'Zoom out' }] },
  ];
  return { menus, picked, onSelect: (v) => picked.set(typeof v === 'string' ? v : v.value) };
}
