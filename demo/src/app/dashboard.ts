import { signal, computed, type Signal } from '@weave-framework/runtime';
import Card from '@weave-framework/ui/card';
import Badge from '@weave-framework/ui/badge';
import Table from '@weave-framework/ui/table';
import Icon from '@weave-framework/ui/icon';
import SlideToggle from '@weave-framework/ui/slide-toggle';
import Select from '@weave-framework/ui/select';
import Expansion from '@weave-framework/ui/expansion';
import Input from '@weave-framework/ui/input';
import Checkbox from '@weave-framework/ui/checkbox';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Button from '@weave-framework/ui/button';
import { openDialog } from '@weave-framework/ui/dialog';
import { snackbar } from '@weave-framework/ui/snackbar';
import { createFeed, type Txn, type TxnStatus, type FeedEvent } from '../lib/feed';

// Capitalized tags in dashboard.html resolve to these imports.
void Card;
void Badge;
void Table;
void Icon;
void SlideToggle;
void Select;
void Expansion;
void Input;
void Checkbox;
void ButtonToggle;
void Button;

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const moneyCompact = (n: number): string =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');

const rel = (secs: number): string => {
  if (secs <= 0) return 'now';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const NAV = [
  { icon: 'house', label: 'Overview' },
  { icon: 'shopping-cart', label: 'Payments' },
  { icon: 'user', label: 'Customers' },
  { icon: 'bell', label: 'Alerts' },
  { icon: 'settings', label: 'Settings' },
];

const NAV_SUB: Record<string, string> = {
  Overview: 'Real-time — every value below is a live signal',
  Payments: 'Transactions, refunds, and payout status',
  Customers: 'Sign-ups, upgrades, and churn',
  Alerts: 'Latency, error-rate, and region health',
  Settings: 'Workspace, billing, and API keys',
};

const ACCENTS = [
  { key: 'violet', color: '#7c6cff' },
  { key: 'emerald', color: '#2dd4a7' },
  { key: 'amber', color: '#f5a623' },
  { key: 'rose', color: '#ff5c8a' },
  { key: 'cyan', color: '#38bdf8' },
];

const FILTER_OPTS = [
  { value: 'all', label: 'All statuses' },
  { value: 'settled', label: 'Settled' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
];

const REGION_OPTS = [
  { value: 'eu', label: 'EU-West (Amsterdam)' },
  { value: 'us', label: 'US-East (Virginia)' },
  { value: 'ap', label: 'AP-South (Mumbai)' },
];

const DENSITY_OPTS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const STATUS_PANELS = [
  { id: 'eu', header: 'EU-West · operational', body: 'p95 68 ms · 0 incidents in the last 24h. Primary region for European traffic.' },
  { id: 'us', header: 'US-East · operational', body: 'p95 74 ms · autoscaled to 12 nodes during the last spike, now settled.' },
  { id: 'ap', header: 'AP-South · degraded', body: 'Elevated latency (p95 141 ms). Investigating a slow database replica.' },
];

const EVENT_ICON: Record<FeedEvent['kind'], string> = {
  signup: 'user',
  upgrade: 'arrow-up',
  payout: 'shopping-cart',
  alert: 'triangle-alert',
};

function statusPill(status: TxnStatus): HTMLElement {
  const el = document.createElement('span');
  el.className = `pill pill--${status}`;
  el.textContent = status[0].toUpperCase() + status.slice(1);
  return el;
}

/** The Actions cell — a real button that opens a dialog for that row. */
function actionButton(t: Txn): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'weave-button weave-button--outline';
  b.textContent = 'View';
  b.onclick = () => openTxnDialog(t);
  return b;
}

/** Click a row's View → modal with the details and real actions → snackbar feedback. */
function openTxnDialog(t: Txn): void {
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
  const refund = document.createElement('button');
  refund.type = 'button';
  refund.className = 'weave-button weave-button--outline';
  refund.textContent = 'Refund';
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'weave-button';
  approve.textContent = 'Approve';
  actions.append(refund, approve);

  const ref = openDialog({
    title: `Transaction #${t.id}`,
    content: `${t.merchant} — ${money(t.amount)} paid via ${t.method}. Current status: ${t.status}.`,
    actions,
  });
  refund.onclick = () => {
    ref.close('refunded');
    snackbar(`Refund issued to ${t.merchant}`, { action: 'Undo', duration: 3500 });
  };
  approve.onclick = () => {
    ref.close('approved');
    snackbar('Payment approved ✓', { duration: 2600 });
  };
}

interface Bar {
  i: number;
  /** bar height, 8–100, in the chart's 0–100 viewBox units */
  h: number;
  /** left edge in viewBox units (geometry precomputed so the template stays plain) */
  x: number;
  /** top edge (100 − h) */
  y: number;
  /** bar width in viewBox units */
  w: number;
  /** the trailing bar gets the highlight gradient */
  last: boolean;
}
function buildBars(xs: number[]): Bar[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const range = max - min || 1;
  const n = xs.length;
  const slot = 100 / n;
  return xs.map((v, i) => {
    const h = Math.round((8 + ((v - min) / range) * 92) * 10) / 10;
    return { i, h, x: i * slot + slot * 0.12, y: 100 - h, w: slot * 0.76, last: i === n - 1 };
  });
}

interface Setup {
  nav: typeof NAV;
  accents: typeof ACCENTS;
  filterOpts: typeof FILTER_OPTS;
  statusPanels: typeof STATUS_PANELS;
  live: Signal<boolean>;
  now: Signal<number>;
  revenue: Signal<number>;
  users: Signal<number>;
  orders: Signal<number>;
  latency: Signal<number>;
  revenueDelta: Signal<number>;
  usersDelta: Signal<number>;
  events: Signal<FeedEvent[]>;
  bars: () => Bar[];
  visibleTxns: () => Txn[];
  columns: unknown[];
  trackTxn: (t: Txn) => number;
  filter: () => string;
  accent: () => string;
  activeNav: () => string;
  openPanels: () => string[];
  navSub: () => string;
  regionOpts: typeof REGION_OPTS;
  densityOpts: typeof DENSITY_OPTS;
  workspace: () => string;
  region: () => string;
  emailAlerts: () => boolean;
  density: () => string;
  setLive: (v: boolean) => void;
  setFilter: (v: unknown) => void;
  setAccent: (key: string) => void;
  selectNav: (label: string) => void;
  setOpenPanels: (v: string[]) => void;
  setWorkspace: (v: string) => void;
  setRegion: (v: unknown) => void;
  setEmailAlerts: (v: boolean) => void;
  setDensity: (v: unknown) => void;
  saveSettings: () => void;
  money: (n: number) => string;
  moneyCompact: (n: number) => string;
  num: (n: number) => string;
  rel: (s: number) => string;
  eventIcon: (k: FeedEvent['kind']) => string;
}

export function setup(): Setup {
  const feed = createFeed();
  feed.start();

  const filter = signal<string>('all');
  const accent = signal<string>('violet');
  const activeNav = signal<string>('Overview');
  const openPanels = signal<string[]>(['eu']);

  // Settings-view form state.
  const workspace = signal<string>('Acme Payments');
  const region = signal<string>('eu');
  const emailAlerts = signal<boolean>(true);
  const density = signal<string>('comfortable');

  const bars = computed(() => buildBars(feed.series()));
  const visibleTxns = computed<Txn[]>(() =>
    filter() === 'all' ? feed.txns() : feed.txns().filter((t) => t.status === filter()),
  );

  const columns = [
    { key: 'merchant', header: 'Merchant' },
    { key: 'method', header: 'Method' },
    { key: 'amount', header: 'Amount', numeric: true, cell: (t: Txn) => money(t.amount) },
    { key: 'status', header: 'Status', cell: (t: Txn) => statusPill(t.status) },
    { key: 'actions', header: '', cell: (t: Txn) => actionButton(t) },
  ];

  const setAccent = (key: string): void => {
    const a = ACCENTS.find((x) => x.key === key);
    if (!a) return;
    // Re-tune the *token* live — every component + custom chunk re-skins instantly.
    document.documentElement.style.setProperty('--weave-color-accent', a.color);
    accent.set(key);
  };

  return {
    nav: NAV,
    accents: ACCENTS,
    filterOpts: FILTER_OPTS,
    statusPanels: STATUS_PANELS,
    live: feed.live,
    now: feed.now,
    revenue: feed.revenue,
    users: feed.users,
    orders: feed.orders,
    latency: feed.latency,
    revenueDelta: feed.revenueDelta,
    usersDelta: feed.usersDelta,
    events: feed.events,
    bars,
    visibleTxns,
    columns,
    trackTxn: (t) => t.id,
    filter,
    accent,
    activeNav,
    openPanels,
    navSub: () => NAV_SUB[activeNav()] ?? '',
    regionOpts: REGION_OPTS,
    densityOpts: DENSITY_OPTS,
    workspace,
    region,
    emailAlerts,
    density,
    setLive: (v) => feed.live.set(v),
    setFilter: (v) => filter.set(v as string),
    setAccent,
    selectNav: (label) => activeNav.set(label),
    setOpenPanels: (v) => openPanels.set(v),
    setWorkspace: (v) => workspace.set(v),
    setRegion: (v) => region.set(v as string),
    setEmailAlerts: (v) => emailAlerts.set(v),
    setDensity: (v) => density.set(v as string),
    saveSettings: () =>
      snackbar(`Settings saved for “${workspace()}”`, { action: 'Dismiss', duration: 3000 }),
    money,
    moneyCompact,
    num,
    rel,
    eventIcon: (k) => EVENT_ICON[k],
  };
}
