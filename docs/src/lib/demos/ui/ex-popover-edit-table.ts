import { signal } from '@weave-framework/runtime';
import { popoverEdit, type PopoverEditConfig } from '@weave-framework/ui/popover-edit';

void popoverEdit;

interface Setup {
  popoverEdit: typeof popoverEdit;
  nameCfg: PopoverEditConfig;
  roleCfg: PopoverEditConfig;
  name: () => string;
  role: () => string;
}

/**
 * The spreadsheet gesture: each cell gets its own config (each config's object lives in
 * setup, referenced by name — never inline). Click a cell, edit in place, Enter or
 * click-away commits, Esc restores.
 */
export function setup(): Setup {
  const name = signal('Ada Lovelace');
  const role = signal('Engineer');

  const nameCfg: PopoverEditConfig = {
    value: () => name(),
    onCommit: (next) => name.set(next),
    label: 'Name',
    placeholder: 'Full name',
  };
  const roleCfg: PopoverEditConfig = {
    value: () => role(),
    onCommit: (next) => role.set(next),
    label: 'Role',
    placeholder: 'Job title',
  };

  return { popoverEdit, nameCfg, roleCfg, name, role };
}
