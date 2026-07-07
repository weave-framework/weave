import { signal } from '@weave-framework/runtime';
import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  commits: number;
}
interface SortState {
  active: string | null;
  direction: 'asc' | 'desc' | null;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
  sort: () => SortState;
  setSort: (s: SortState) => void;
}

/**
 * Sortable headers cycle asc → desc → none. Here the sort is controlled via `sort` + `onSort`;
 * the name column uses a custom `compare` (by length), `disableClear` keeps it asc ↔ desc.
 */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', commits: 128 },
    { id: 2, name: 'Rūta', commits: 74 },
    { id: 3, name: 'Marius', commits: 203 },
    { id: 4, name: 'Ona', commits: 96 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true, compare: (a: Row, b: Row) => a.name.length - b.name.length },
    { key: 'commits', header: 'Commits', numeric: true, sortable: true },
  ];
  const sort = signal<SortState>({ active: 'commits', direction: 'desc' });
  return { rows, columns, trackBy: (r) => r.id, sort, setSort: (s) => sort.set(s) };
}
