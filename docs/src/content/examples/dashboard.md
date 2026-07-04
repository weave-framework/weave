# Data dashboard

Show a list of anything real — orders, users, projects — and you'll want the same three things: **filter** it
down, **sort** it, and **paginate** it. This example wires all three into a single derived pipeline, feeds the
result to a [`Table`](/ui/table), and tops it with KPI cards that recompute as you filter.

:::demo examples-dashboard

Change the status filter and watch the cards update. Click a column header to sort. Page through with the
paginator, or change the page size.

## What it shows

- **A derived pipeline** — `filtered → sorted → paginated`, three `computed` stages where each recomputes only
  when its own input changes. [Reactivity in depth →](/learn/reactivity)
- **Owning the data, not the widget** — the `Table` renders; *you* decide the order and the page. `clientSort` is
  turned off and `onSort` feeds back into a signal, so sorting spans all pages, not just the visible one.
- **Custom cells** — the Status and Progress columns render real DOM nodes (a pill, a meter) via each column's
  `cell` function.
- **Live KPIs** — the [`Card`](/ui/card) row reads the *filtered* set, so the summary always matches what's on
  screen. One card embeds a real [`ProgressBar`](/ui/progress-bar), another a [`Badge`](/ui/badge).
- **Real components** — [`Table`](/ui/table), [`Select`](/ui/select), [`Paginator`](/ui/paginator),
  [`Card`](/ui/card), [`ProgressBar`](/ui/progress-bar), [`Badge`](/ui/badge).

## The pipeline

This is the heart of the example. Three `computed` signals chain off the source data and the control signals
(`status`, `sort`, `page`, `size`). Nothing pushes; each stage *pulls* from the one before it and only reruns when
something it read actually changed.

:::tabs
~~~ts title="pipeline (in app.ts)"
// Source data + the four control signals.
const status = signal<string>('all');
const sort = signal<SortState>({ active: 'name', direction: 'asc' });
const page = signal(0);
const size = signal(6);

// Stage 1 — filter by status.
const filtered = computed(() => SEED.filter((p) => status() === 'all' || p.status === status()));

// Stage 2 — sort the filtered set (numbers numerically, text with localeCompare).
const sorted = computed(() => {
  const s = sort();
  const rows = [...filtered()];
  if (s.active && s.direction) {
    const key = s.active as keyof Project;
    const dir = s.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return rows;
});

// Stage 3 — slice out the current page.
const total = computed(() => sorted().length);
const pageRows = computed(() => {
  const start = page() * size();
  return sorted().slice(start, start + size());
});
~~~
:::

:::callout note "Why turn off the Table's own sort?"
`Table` will happily sort an array you hand it — but only the rows it was *given*. If you also paginate, that's
just the current page, so the sort would be wrong across page boundaries. By setting `clientSort={{ false }}` and
handling `onSort` yourself, the sort runs over the **whole** filtered set *before* it's sliced into pages.
:::

## The columns

Two columns render plain text (`name`, `budget`); the other two use a `cell` function that returns a DOM node — a
coloured pill for status, a mini meter for progress. That's the whole custom-cell API: return a `string` or a
`Node`.

:::tabs
~~~ts title="columns + cell renderers (in app.ts)"
const columns = [
  { key: 'name', header: 'Project', sortable: true },
  { key: 'status', header: 'Status', cell: (p: Project) => statusPill(p.status) },
  { key: 'progress', header: 'Progress', sortable: true, cell: (p: Project) => progressCell(p.progress) },
  { key: 'budget', header: 'Budget', numeric: true, sortable: true, cell: (p: Project) => money(p.budget) },
];

function statusPill(status: Status): HTMLElement {
  const el = document.createElement('span');
  el.className = `dash-pill dash-pill--${status}`;
  el.textContent = status[0].toUpperCase() + status.slice(1);
  return el;
}

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
~~~
:::

## The template

The KPI cards read one `kpi` computed; the table is handed `pageRows` (the source), the controlled `sort` state,
and `onSort`; the paginator is bound to `total`, `page`, and `size`. Every prop is a plain binding.

:::tabs
~~~html title="app.html"
<div class="dash">
  <div class="dash__kpis">
    <Card class="dash__kpi">
      <span class="dash__kpi-label">Projects</span>
      <span class="dash__kpi-value">{{ kpi().count }}</span>
    </Card>
    <Card class="dash__kpi">
      <span class="dash__kpi-label">Active</span>
      <span class="dash__kpi-value">{{ kpi().active }} <Badge variant={{ 'tag' }}>live</Badge></span>
    </Card>
    <Card class="dash__kpi">
      <span class="dash__kpi-label">Avg. progress</span>
      <span class="dash__kpi-value">{{ kpi().avg }}%</span>
      <ProgressBar value={{ kpi().avg }} label={{ 'Average completion' }} />
    </Card>
    <Card class="dash__kpi">
      <span class="dash__kpi-label">Budget</span>
      <span class="dash__kpi-value">{{ kpi().budget }}</span>
    </Card>
  </div>

  <div class="dash__controls">
    <Select options={{ statusOpts }} value={{ status() }} onChange={{ setStatus }} label={{ 'Filter by status' }} />
    <span class="dash__result-count">{{ total() }} projects</span>
  </div>

  <Table columns={{ columns }} dataSource={{ pageRows }} sort={{ sort() }} onSort={{ onSort }}
         clientSort={{ false }} trackBy={{ trackBy }} ariaLabel={{ 'Projects' }} />

  <Paginator length={{ total() }} pageSize={{ size() }} pageIndex={{ page() }} onPage={{ onPage }}
             pageSizeOptions={{ [6, 12, 18] }} />
</div>
~~~
~~~ts title="handlers (in app.ts)"
return {
  columns, statusOpts, status, sort, page, size, total, pageRows, kpi,
  trackBy: (p: Project) => p.id,
  setStatus: (v: string | string[]) => { status.set(v as string); page.set(0); },
  onSort: (s: SortState) => { sort.set({ active: s.active, direction: s.direction }); page.set(0); },
  onPage: (e: { pageIndex: number; pageSize: number }) => { page.set(e.pageIndex); size.set(e.pageSize); },
};
~~~
:::

Notice that both `setStatus` and `onSort` **reset the page to 0**. That's the one bit of glue between the stages:
change the filter or the sort and you want to be looking at the first page of the new result, not stranded on
page 3 of a list that no longer has one.

## Notes

- **`trackBy` keeps rows stable.** Rows are keyed by `id`, so when you sort, Weave moves the existing row
  elements instead of tearing them down and rebuilding — smoother, and it preserves anything stateful in a row.
- **The KPIs are free.** They're just another `computed` over the same `filtered` set. Deriving a summary is the
  same tool as deriving the table body — there's no separate "stats" machinery.
- **Swap the source and nothing else changes.** `SEED` could be a `signal` filled by a `fetch`; the entire
  pipeline downstream is identical, because it only ever reads through `filtered()`.

Next up: forms. The [Settings panel](/examples/settings) puts every form control on one screen.
