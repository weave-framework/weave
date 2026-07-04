import { signal, computed } from '@weave-framework/runtime';
import Card from '@weave-framework/ui/card';
import Badge from '@weave-framework/ui/badge';
import Select from '@weave-framework/ui/select';
import Table from '@weave-framework/ui/table';
import Paginator from '@weave-framework/ui/paginator';
import ProgressBar from '@weave-framework/ui/progress-bar';

// Capitalized tags in the template resolve to these imports.
void Card;
void Badge;
void Select;
void Table;
void Paginator;
void ProgressBar;

type Status = 'active' | 'paused' | 'done';
interface Project {
  id: number;
  name: string;
  status: Status;
  progress: number;
  budget: number;
}
interface SortState {
  active: string | null;
  direction: 'asc' | 'desc' | null;
}
interface PageEvent {
  pageIndex: number;
  pageSize: number;
}

const NAMES = [
  'Aurora', 'Beacon', 'Cascade', 'Delta', 'Ember', 'Fjord', 'Glacier', 'Harbor', 'Ionia',
  'Juno', 'Kelvin', 'Lumen', 'Meridian', 'Nimbus', 'Orbit', 'Pallas', 'Quartz', 'Reef',
];
const STATUSES: Status[] = ['active', 'paused', 'done'];

// A deterministic seed — 18 projects, no randomness so the demo is reproducible.
const SEED: Project[] = NAMES.map((name, i) => ({
  id: i + 1,
  name: `Project ${name}`,
  status: STATUSES[i % 3],
  progress: (i * 37 + 15) % 101,
  budget: 5000 + (i % 7) * 1500,
}));

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** A coloured status pill — a plain element so the cell stays self-contained. */
function statusPill(status: Status): HTMLElement {
  const el = document.createElement('span');
  el.className = `dash-pill dash-pill--${status}`;
  el.textContent = status[0].toUpperCase() + status.slice(1);
  return el;
}

/** A compact inline progress meter for the Progress column. */
function progressCell(value: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dash-meter';
  const track = document.createElement('div');
  track.className = 'dash-meter__track';
  const fill = document.createElement('i');
  fill.className = 'dash-meter__fill';
  fill.style.width = `${value}%`;
  track.append(fill);
  const label = document.createElement('span');
  label.className = 'dash-meter__label';
  label.textContent = `${value}%`;
  wrap.append(track, label);
  return wrap;
}

interface Setup {
  columns: unknown[];
  statusOpts: { value: string; label: string }[];
  status: () => string;
  sort: () => SortState;
  page: () => number;
  size: () => number;
  total: () => number;
  pageRows: () => Project[];
  kpi: () => { count: number; active: number; avg: number; budget: string };
  trackBy: (p: Project) => number;
  setStatus: (v: string | string[]) => void;
  onSort: (s: SortState) => void;
  onPage: (e: PageEvent) => void;
}

/** The dashboard component: filter → sort → paginate, all owned here. */
export function setup(): Setup {
  const status = signal<string>('all');
  const sort = signal<SortState>({ active: 'name', direction: 'asc' });
  const page = signal(0);
  const size = signal(6);

  const statusOpts = [
    { value: 'all', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'done', label: 'Done' },
  ];

  const columns = [
    { key: 'name', header: 'Project', sortable: true },
    { key: 'status', header: 'Status', cell: (p: Project) => statusPill(p.status) },
    { key: 'progress', header: 'Progress', sortable: true, cell: (p: Project) => progressCell(p.progress) },
    { key: 'budget', header: 'Budget', numeric: true, sortable: true, cell: (p: Project) => money(p.budget) },
  ];

  // The pipeline — three derived stages, each recomputed only when its input changes.
  const filtered = computed<Project[]>(() =>
    SEED.filter((p) => status() === 'all' || p.status === status()),
  );
  const sorted = computed<Project[]>(() => {
    const s = sort();
    const rows = [...filtered()];
    if (s.active && s.direction) {
      const key = s.active as keyof Project;
      const dir = s.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return rows;
  });
  const total = computed(() => sorted().length);
  const pageRows = computed<Project[]>(() => {
    const start = page() * size();
    return sorted().slice(start, start + size());
  });

  // KPI cards track the *filtered* set, so changing the filter updates them live.
  const kpi = computed(() => {
    const set = filtered();
    const count = set.length;
    const active = set.filter((p) => p.status === 'active').length;
    const avg = count ? Math.round(set.reduce((s, p) => s + p.progress, 0) / count) : 0;
    const budget = money(set.reduce((s, p) => s + p.budget, 0));
    return { count, active, avg, budget };
  });

  return {
    columns,
    statusOpts,
    status,
    sort,
    page,
    size,
    total,
    pageRows,
    kpi,
    trackBy: (p) => p.id,
    setStatus: (v) => {
      status.set(v as string);
      page.set(0);
    },
    onSort: (s) => {
      sort.set({ active: s.active, direction: s.direction });
      page.set(0);
    },
    onPage: (e) => {
      page.set(e.pageIndex);
      size.set(e.pageSize);
    },
  };
}
