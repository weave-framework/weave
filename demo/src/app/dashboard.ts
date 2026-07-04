import { computed, type Signal } from '@weave-framework/runtime';
import Card from '@weave-framework/ui/card';
import Badge from '@weave-framework/ui/badge';
import Table from '@weave-framework/ui/table';
import Icon from '@weave-framework/ui/icon';
import { createFeed, type Txn, type TxnStatus, type FeedEvent } from '../lib/feed';

// Capitalized tags in dashboard.html resolve to these imports.
void Card;
void Badge;
void Table;
void Icon;

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const moneyCompact = (n: number): string =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
const num = (n: number): string => Math.round(n).toLocaleString('en-US');

/** "Xs" / "1m 4s" — relative age in seconds, used live in the activity feed. */
const rel = (secs: number): string => {
  if (secs <= 0) return 'now';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const NAV = [
  { icon: 'house', label: 'Overview', active: true },
  { icon: 'shopping-cart', label: 'Payments', active: false },
  { icon: 'user', label: 'Customers', active: false },
  { icon: 'bell', label: 'Alerts', active: false },
  { icon: 'settings', label: 'Settings', active: false },
];

const EVENT_ICON: Record<FeedEvent['kind'], string> = {
  signup: 'user',
  upgrade: 'arrow-up',
  payout: 'shopping-cart',
  alert: 'triangle-alert',
};

/** A coloured status pill for the transactions table (plain DOM, self-contained). */
function statusPill(status: TxnStatus): HTMLElement {
  const el = document.createElement('span');
  el.className = `pill pill--${status}`;
  el.textContent = status[0].toUpperCase() + status.slice(1);
  return el;
}

interface Bar {
  i: number;
  h: number;
}

/** Normalise the rolling series into fixed slots (stable keys) with 0–100% heights, so
 *  each tick only nudges the bound heights — the DOM nodes persist. */
function buildBars(xs: number[]): Bar[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const range = max - min || 1;
  return xs.map((v, i) => ({ i, h: Math.round((8 + ((v - min) / range) * 92) * 10) / 10 }));
}

interface Setup {
  nav: typeof NAV;
  now: Signal<number>;
  revenue: Signal<number>;
  users: Signal<number>;
  orders: Signal<number>;
  latency: Signal<number>;
  revenueDelta: Signal<number>;
  usersDelta: Signal<number>;
  txns: Signal<Txn[]>;
  events: Signal<FeedEvent[]>;
  bars: () => Bar[];
  columns: unknown[];
  trackTxn: (t: Txn) => number;
  money: (n: number) => string;
  moneyCompact: (n: number) => string;
  num: (n: number) => string;
  rel: (s: number) => string;
  eventIcon: (k: FeedEvent['kind']) => string;
}

export function setup(): Setup {
  const feed = createFeed();
  feed.start(); // single-page dashboard: runs for the life of the tab

  const columns = [
    { key: 'merchant', header: 'Merchant', sortable: false },
    { key: 'method', header: 'Method' },
    { key: 'amount', header: 'Amount', numeric: true, cell: (t: Txn) => money(t.amount) },
    { key: 'status', header: 'Status', cell: (t: Txn) => statusPill(t.status) },
  ];

  const bars = computed(() => buildBars(feed.series()));

  return {
    nav: NAV,
    now: feed.now,
    revenue: feed.revenue,
    users: feed.users,
    orders: feed.orders,
    latency: feed.latency,
    revenueDelta: feed.revenueDelta,
    usersDelta: feed.usersDelta,
    txns: feed.txns,
    events: feed.events,
    bars,
    columns,
    trackTxn: (t) => t.id,
    money,
    moneyCompact,
    num,
    rel,
    eventIcon: (k) => EVENT_ICON[k],
  };
}
