import { signal, type Signal } from '@weave-framework/runtime';

/**
 * A simulated live data feed. Everything here runs client-side — no API, no server — so
 * the whole app deploys as a static file. Each tick nudges a handful of signals; because
 * Weave is fine-grained, only the exact numbers/rows that move actually repaint.
 */

export type TxnStatus = 'settled' | 'pending' | 'failed';

export interface Txn {
  id: number;
  merchant: string;
  method: string;
  amount: number;
  status: TxnStatus;
  createdAt: number; // seconds counter, for the "Xs ago" column
}

export interface FeedEvent {
  id: number;
  kind: 'signup' | 'upgrade' | 'payout' | 'alert';
  text: string;
  createdAt: number;
}

export interface Feed {
  live: Signal<boolean>;
  now: Signal<number>;
  revenue: Signal<number>;
  users: Signal<number>;
  orders: Signal<number>;
  latency: Signal<number>;
  revenueDelta: Signal<number>;
  usersDelta: Signal<number>;
  series: Signal<number[]>;
  txns: Signal<Txn[]>;
  events: Signal<FeedEvent[]>;
  start: () => () => void;
}

const MERCHANTS = [
  'Northwind', 'Aperture', 'Umbrella', 'Initech', 'Hooli', 'Stark Ind.',
  'Wayne Ent.', 'Cyberdyne', 'Soylent', 'Gringotts', 'Wonka', 'Tyrell',
];
const METHODS = ['Visa', 'Mastercard', 'Amex', 'SEPA', 'PayPal', 'Apple Pay'];
const STATUSES: TxnStatus[] = ['settled', 'settled', 'settled', 'pending', 'failed'];

const EVENT_KINDS: FeedEvent['kind'][] = ['signup', 'upgrade', 'payout', 'alert'];
const EVENT_TEXT: Record<FeedEvent['kind'], () => string> = {
  signup: () => `New sign-up from ${pick(MERCHANTS)}`,
  upgrade: () => `${pick(MERCHANTS)} upgraded to Scale`,
  payout: () => `Payout of ${money(rnd(400, 9000))} completed`,
  alert: () => `Latency spike on ${pick(['eu-west', 'us-east', 'ap-south'])}`,
};

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}
function rnd(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** Build a feed with a seeded, plausible starting state, ready to `start()`. */
export function createFeed(): Feed {
  const live = signal(true);
  const now = signal(0);
  const revenue = signal(284_120);
  const users = signal(3_418);
  const orders = signal(12_704);
  const latency = signal(72);
  const revenueDelta = signal(0);
  const usersDelta = signal(0);

  // A rolling window of throughput samples for the chart (newest last).
  const series = signal<number[]>(
    Array.from({ length: 48 }, (_, i) => 60 + Math.round(30 * Math.sin(i / 5) + rnd(-8, 8))),
  );

  let txnId = 1000;
  let eventId = 500;

  const seedTxns: Txn[] = Array.from({ length: 8 }, () => makeTxn(0));
  const txns = signal<Txn[]>(seedTxns);
  const events = signal<FeedEvent[]>(
    Array.from({ length: 6 }, (_, i) => makeEvent(-i * 3)),
  );

  function makeTxn(at: number): Txn {
    return {
      id: ++txnId,
      merchant: pick(MERCHANTS),
      method: pick(METHODS),
      amount: rnd(9, 2400),
      status: pick(STATUSES),
      createdAt: at,
    };
  }
  function makeEvent(at: number): FeedEvent {
    const kind = pick(EVENT_KINDS);
    return { id: ++eventId, kind, text: EVENT_TEXT[kind](), createdAt: at };
  }

  function tick(): void {
    if (!live()) return; // paused — freeze the whole feed
    const t = now() + 1;
    now.set(t);

    // KPIs — mostly-up random walks so the story reads well.
    const rDelta = rnd(-40, 220);
    revenue.set((v) => Math.max(0, v + rDelta));
    revenueDelta.set(rDelta);

    const uDelta = rnd(-2, 6);
    users.set((v) => Math.max(0, v + uDelta));
    usersDelta.set(uDelta);

    if (Math.random() < 0.7) orders.set((v) => v + rnd(1, 4));
    latency.set(rnd(46, 128));

    // Chart: push a new throughput sample, keep the window at 48.
    series.set((xs) => {
      const next = Math.max(8, xs[xs.length - 1] + rnd(-14, 15));
      return [...xs.slice(1), next];
    });

    // Occasionally a new transaction lands (prepend, cap at 8 visible).
    if (Math.random() < 0.55) {
      txns.set((rows) => [makeTxn(t), ...rows].slice(0, 8));
    } else if (Math.random() < 0.25) {
      // Or a pending one settles/fails — a targeted single-row update.
      txns.set((rows) => {
        const i = rows.findIndex((r) => r.status === 'pending');
        if (i < 0) return rows;
        const copy = [...rows];
        copy[i] = { ...copy[i], status: Math.random() < 0.8 ? 'settled' : 'failed' };
        return copy;
      });
    }

    // Occasionally a new activity event (prepend, cap at 6).
    if (Math.random() < 0.4) {
      events.set((xs) => [makeEvent(t), ...xs].slice(0, 6));
    }
  }

  return {
    live,
    now,
    revenue,
    users,
    orders,
    latency,
    revenueDelta,
    usersDelta,
    series,
    txns,
    events,
    start() {
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    },
  };
}
