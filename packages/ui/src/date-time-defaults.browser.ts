import { test, assert } from '../../../tools/harness.js';
import {
  signal,
  effect,
  createOwner,
  runInOwner,
  disposeOwner,
  type Owner,
  type Signal,
} from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { provideDateTimeDefaults, type DateTimeDefaults } from '@weave-framework/ui';
import { createDateAdapter } from '@weave-framework/ui/cdk';
import * as IconMod from '@weave-framework/ui/icon';
import { toComponent } from './internal/compose.js';
import {
  setup as dpSetup,
  template as dpTemplate,
  type DatepickerProps,
  type DatepickerContext,
} from '@weave-framework/ui/datepicker';
import {
  setup as rpSetup,
  type DateRangePickerProps,
  type DateRangePickerContext,
} from '@weave-framework/ui/date-range-picker';
import { setup as tpSetup, type TimepickerProps, type TimepickerContext } from '@weave-framework/ui/timepicker';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const A: ReturnType<typeof createDateAdapter> = createDateAdapter({ locale: 'en-US' });
const JUN15: Date = A.create(2026, 5, 15);

interface Scoped<T> {
  value: T;
  dispose: () => void;
}

/**
 * Run `fn` inside a child owner of a scope that provided `defaults` — which is exactly the shape at
 * runtime (the app root provides, the picker's own owner is a descendant). The child owner captures
 * the ambient owner as its context parent, so `inject` walks up into the provider.
 */
function withDefaults<T>(defaults: DateTimeDefaults | null, fn: () => T): Scoped<T> {
  const app: Owner = createOwner();
  const value: T = runInOwner(app, () => {
    if (defaults) provideDateTimeDefaults(defaults);
    // `createOwner(app)` — the argument wires DISPOSAL; the ambient owner (also `app`) is what
    // `inject` walks. Passing nothing would leave the component's owner undisposed, and its overlay
    // in the document.
    return runInOwner(createOwner(app), fn);
  });
  return { value, dispose: (): void => disposeOwner(app) };
}

/* ─────────────────── resolution order, on the setup context ─────────────────── */

test('defaults: datepicker labels come from the context when the prop is absent (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { datepickerLabels: { clear: 'Wissen', openCalendar: 'Kalender openen' } },
    (): DatepickerContext => dpSetup({ value: JUN15, clearable: true }),
  );
  assert.equal(ctx.clearLabel(), 'Wissen');
  assert.equal(ctx.openCalendarLabel(), 'Kalender openen');
  dispose();
});

test('defaults: an instance prop always wins over the context (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { datepickerLabels: { clear: 'Wissen' } },
    (): DatepickerContext => dpSetup({ value: JUN15, clearable: true, labels: { clear: 'Per-field' } }),
  );
  assert.equal(ctx.clearLabel(), 'Per-field');
  dispose();
});

test('defaults: with nothing provided the built-in English defaults stand (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(null, (): DatepickerContext =>
    dpSetup({ value: JUN15, clearable: true }),
  );
  assert.equal(ctx.clearLabel(), 'Clear');
  assert.equal(ctx.openCalendarLabel(), 'Open calendar');
  dispose();
});

test('defaults: labels merge shallowly — a partial set never blanks the other keys (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { datepickerLabels: { clear: 'Wissen' } }, // openCalendar deliberately omitted
    (): DatepickerContext => dpSetup({ value: JUN15, clearable: true }),
  );
  assert.equal(ctx.clearLabel(), 'Wissen', 'the provided key applies');
  assert.equal(ctx.openCalendarLabel(), 'Open calendar', 'the omitted key keeps its English default');
  dispose();
});

test('defaults: displayFormat and locale flow through to the formatted field text (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { locale: 'en-GB', displayFormat: { day: '2-digit', month: '2-digit', year: 'numeric' } },
    (): DatepickerContext => dpSetup({ value: JUN15 }),
  );
  assert.equal(ctx.displayText(), '15/06/2026', 'en-GB dd/mm/yyyy, from the context alone');
  dispose();
});

test('defaults: a provided adapter is used when the instance passes none (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { adapter: createDateAdapter({ locale: 'de-DE' }), displayFormat: { dateStyle: 'short' } },
    (): DatepickerContext => dpSetup({ value: JUN15 }),
  );
  assert.ok(ctx.displayText().includes('26'), `German short date, got ${JSON.stringify(ctx.displayText())}`);
  dispose();
});

/* ─────────────────── getters keep it live ─────────────────── */

test('defaults: a getter re-reads, so a language change reaches a mounted field (FW-19)', () => {
  const lang: Signal<string> = signal<string>('en');
  const { value: ctx, dispose } = withDefaults(
    { datepickerLabels: (): { clear: string } => ({ clear: lang() === 'nl' ? 'Wissen' : 'Clear' }) },
    (): DatepickerContext => dpSetup({ value: JUN15, clearable: true }),
  );
  assert.equal(ctx.clearLabel(), 'Clear');
  lang.set('nl');
  assert.equal(ctx.clearLabel(), 'Wissen', 'the getter is read again, not captured at setup');
  dispose();
});

test('defaults: a plain (non-getter) value is accepted and simply never changes (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { firstDayOfWeek: 0, datepickerLabels: { clear: 'Static' } },
    (): DatepickerContext => dpSetup({ value: JUN15, clearable: true }),
  );
  assert.equal(ctx.clearLabel(), 'Static');
  dispose();
});

/* ─────────────────── the range picker reads the same context ─────────────────── */

test('defaults: DateRangePicker shares the date defaults (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { locale: 'en-GB', displayFormat: { day: '2-digit', month: '2-digit', year: 'numeric' }, datepickerLabels: { clear: 'Wissen' } },
    (): DateRangePickerContext =>
      rpSetup({ value: { start: JUN15, end: A.create(2026, 5, 20) }, clearable: true } as DateRangePickerProps),
  );
  assert.equal(ctx.clearLabel(), 'Wissen');
  assert.ok(ctx.displayText().startsWith('15/06/2026'), `got ${JSON.stringify(ctx.displayText())}`);
  dispose();
});

/* ─────────────────── the timepicker ─────────────────── */

test('defaults: timepicker use24 comes from the context (FW-19)', () => {
  const h24: Scoped<TimepickerContext> = withDefaults(
    { timepicker: { use24: true } },
    (): TimepickerContext => tpSetup({ value: { hours: 15, minutes: 30 } } as TimepickerProps),
  );
  assert.ok(h24.value.displayText().includes('15'), `24h expected, got ${JSON.stringify(h24.value.displayText())}`);
  h24.dispose();

  const h12: Scoped<TimepickerContext> = withDefaults(
    { timepicker: { use24: false }, locale: 'en-US' },
    (): TimepickerContext => tpSetup({ value: { hours: 15, minutes: 30 } } as TimepickerProps),
  );
  assert.ok(h12.value.displayText().includes('3'), `12h expected, got ${JSON.stringify(h12.value.displayText())}`);
  h12.dispose();
});

test('defaults: timepicker use24 prop still wins over the context (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { timepicker: { use24: false }, locale: 'en-US' },
    (): TimepickerContext => tpSetup({ value: { hours: 15, minutes: 30 }, use24: true } as TimepickerProps),
  );
  assert.ok(ctx.displayText().includes('15'), `the prop wins, got ${JSON.stringify(ctx.displayText())}`);
  dispose();
});

test('defaults: timepicker clearLabel comes from the context (FW-19)', () => {
  const { value: ctx, dispose } = withDefaults(
    { timepicker: { clearLabel: 'Wissen' } },
    (): TimepickerContext => tpSetup({ value: { hours: 9, minutes: 0 }, clearable: true } as TimepickerProps),
  );
  assert.equal(ctx.clearLabel(), 'Wissen');
  dispose();
});

test('defaults: a timepicker getter is re-read, so a settings change lands (FW-19)', () => {
  const h24: Signal<boolean> = signal<boolean>(false);
  const { value: ctx, dispose } = withDefaults(
    { locale: 'en-US', timepicker: (): { use24: boolean } => ({ use24: h24() }) },
    (): TimepickerContext => tpSetup({ value: { hours: 15, minutes: 30 } } as TimepickerProps),
  );
  assert.ok(ctx.displayText().includes('3'), '12h first');
  h24.set(true);
  assert.ok(ctx.displayText().includes('15'), 'flipping the setting flips the field');
  dispose();
});

/* ─────────────────── firstDayOfWeek, through a real rendered calendar ─────────────────── */

const DP_SCOPE: string[] = inferCtxNames(parseTemplate(dpTemplate));
type MakeRender = (
  ctx: DatepickerContext,
  rt: unknown,
  c: unknown,
) => (ctx: DatepickerContext, slots: Record<string, () => Node>) => HTMLElement;

interface Opened {
  dispose: () => void;
}

/** Mount a real `<Datepicker>` under a provider and open its calendar. */
async function mountOpened(
  defaults: DateTimeDefaults | null,
  props: DatepickerProps,
): Promise<Opened> {
  const app: Owner = createOwner();
  const root: HTMLElement = runInOwner(app, () => {
    if (defaults) provideDateTimeDefaults(defaults);
    return runInOwner(createOwner(app), () => {
      const ctx: DatepickerContext = dpSetup(props);
      const { code } = compileTemplate(dpTemplate, { mode: 'function', scope: DP_SCOPE });
      const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
      return make(ctx, rt, { Icon: toComponent(IconMod as never) })(ctx, {});
    });
  });
  document.body.appendChild(root);
  await tick();
  (root.querySelector('.weave-datepicker__field') as HTMLElement).click();
  await tick();
  return {
    dispose: (): void => {
      disposeOwner(app);
      root.remove();
    },
  };
}

const weekdayTexts = (): string[] =>
  Array.from(document.body.querySelectorAll('.weave-datepicker__weekday')).map((e) => e.textContent ?? '');

test('defaults: firstDayOfWeek from the context reorders the real calendar header (FW-19)', async () => {
  const m: Opened = await mountOpened({ firstDayOfWeek: 0, locale: 'en-US' }, { value: JUN15 });
  assert.equal(weekdayTexts()[0], 'S', 'Sunday-first, from the context alone');
  assert.equal(weekdayTexts()[1], 'M');
  m.dispose();
});

test('defaults: a firstDayOfWeek prop overrides the context (FW-19)', async () => {
  const m: Opened = await mountOpened({ firstDayOfWeek: 0, locale: 'en-US' }, { value: JUN15, firstDayOfWeek: 1 });
  assert.equal(weekdayTexts()[0], 'M', 'the instance prop wins');
  m.dispose();
});

test('defaults: no context keeps the built-in Monday start (FW-19)', async () => {
  const m: Opened = await mountOpened(null, { value: JUN15, locale: 'en-US' });
  assert.equal(weekdayTexts()[0], 'M', 'unchanged for an app that provides nothing');
  m.dispose();
});
