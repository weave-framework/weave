import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  role: string;
  city: string;
  commits: number;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
}

/**
 * `sticky: 'start' | 'end'` freezes a column to an edge while the body scrolls sideways (a sticky
 * column needs a numeric `width` for the offset maths). The header is always pinned; `maxHeight`
 * on the `<Table>` caps the body so it scrolls vertically while the header stays.
 */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', role: 'Lead', city: 'Vilnius', commits: 128 },
    { id: 2, name: 'Rūta', role: 'Design', city: 'Kaunas', commits: 74 },
    { id: 3, name: 'Marius', role: 'Backend', city: 'Klaipėda', commits: 203 },
    { id: 4, name: 'Ona', role: 'Frontend', city: 'Šiauliai', commits: 96 },
    { id: 5, name: 'Petras', role: 'QA', city: 'Panevėžys', commits: 51 },
  ];
  const columns = [
    { key: 'name', header: 'Name', sticky: 'start', width: 120 },
    { key: 'role', header: 'Role', width: 160 },
    { key: 'city', header: 'City', width: 160 },
    { key: 'commits', header: 'Commits', numeric: true, sticky: 'end', width: 110 },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
