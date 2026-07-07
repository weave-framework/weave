import { signal } from '@weave-framework/runtime';
import Autocomplete from '@weave-framework/ui/autocomplete';

// Capitalized tags in the template resolve to this import.
void Autocomplete;

interface User {
  id: number;
  name: string;
  email: string;
}

interface Setup {
  users: User[];
  optionValue: (u: User) => string;
  optionLabel: (u: User) => string;
  optionDescription: (u: User) => string;
  chosen: () => string;
  onSelect: (item: unknown) => void;
}

/**
 * Options can be ANY shape — point the accessors (`optionValue` / `optionLabel` /
 * `optionDescription`) at your data's fields. `optionDescription` adds subtext under each row.
 */
export function setup(): Setup {
  const chosen = signal('');
  const users: User[] = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com' },
    { id: 3, name: 'Grace Hopper', email: 'grace@example.com' },
    { id: 4, name: 'Katherine Johnson', email: 'katherine@example.com' },
  ];
  return {
    users,
    optionValue: (u) => String(u.id),
    optionLabel: (u) => u.name,
    optionDescription: (u) => u.email,
    chosen,
    onSelect: (item) => chosen.set((item as User).name),
  };
}
