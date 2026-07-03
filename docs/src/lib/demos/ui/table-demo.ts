import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  role: string;
  commits: number;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
}

/** A sortable, selectable data table. */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', commits: 74 },
    { id: 3, name: 'Marius', role: 'Backend', commits: 203 },
    { id: 4, name: 'Ona', role: 'Frontend', commits: 96 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sortable: true },
    { key: 'role', header: 'Role' },
    { key: 'commits', header: 'Commits', numeric: true, sortable: true },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
