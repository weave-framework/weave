import Table from '@weave-framework/ui/table';

// Capitalized tags in the template resolve to this import.
void Table;

interface Row {
  id: number;
  name: string;
  status: 'active' | 'away';
  score: number;
}
interface Setup {
  rows: Row[];
  columns: unknown[];
  trackBy: (r: Row) => number;
}

/**
 * A column's `header` and `cell` can each be a node factory (`() => Node` / `(row) => Node`).
 * Here the status cell returns a styled pill, and `align: 'center'` centres it.
 */
export function setup(): Setup {
  const rows: Row[] = [
    { id: 1, name: 'Aidas', status: 'active', score: 128 },
    { id: 2, name: 'Rūta', status: 'away', score: 74 },
    { id: 3, name: 'Marius', status: 'active', score: 203 },
    { id: 4, name: 'Ona', status: 'away', score: 96 },
  ];

  const pill = (row: Row): Node => {
    const span = document.createElement('span');
    const on = row.status === 'active';
    span.textContent = on ? 'Active' : 'Away';
    span.style.cssText =
      `padding:1px 8px;border-radius:999px;font-size:12px;` +
      `background:${on ? 'var(--accent-soft, #e6f4ea)' : 'var(--surface-2, #eee)'};` +
      `color:${on ? 'var(--accent, #1a7f37)' : 'var(--fg-muted, #666)'}`;
    return span;
  };
  const headerNode = (): Node => {
    const b = document.createElement('span');
    b.textContent = 'Status';
    b.style.fontStyle = 'italic';
    return b;
  };

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'status', header: headerNode, cell: pill, align: 'center' },
    { key: 'score', header: 'Score', numeric: true },
  ];
  return { rows, columns, trackBy: (r) => r.id };
}
