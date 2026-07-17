import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, createOwner, runInOwner, disposeOwner, type Owner } from '@weave-framework/runtime';
import * as dom from '@weave-framework/runtime/dom';
import { compileTemplate, inferCtxNames, parseTemplate } from '@weave-framework/compiler';
import { createDateAdapter, setDirection, type DateAdapter } from '@weave-framework/ui/cdk';
import { setup, template, type DatepickerProps, type DatepickerContext, type DatepickerControl } from '@weave-framework/ui/datepicker';
import * as IconMod from '@weave-framework/ui/icon';
import { toComponent } from '../internal/compose.js';

const rt: typeof dom & { signal: typeof signal; effect: typeof effect } = { ...dom, signal, effect };
const tick = (): Promise<void> => new Promise<void>((r) => queueMicrotask(r));
const A: DateAdapter = createDateAdapter({ locale: 'en-US' });

type MakeRender = (ctx: DatepickerContext, rt: unknown, c: unknown) => (ctx: DatepickerContext, slots: Record<string, () => Node>) => HTMLElement;

interface Mounted {
  root: HTMLElement;
  owner: Owner;
  dispose: () => void;
}

const SCOPE: string[] = inferCtxNames(parseTemplate(template));

async function mount(props: DatepickerProps): Promise<Mounted> {
  const owner: Owner = createOwner();
  const root: HTMLElement = runInOwner(owner, () => {
    const ctx: DatepickerContext = setup(props);
    const { code } = compileTemplate(template, { mode: 'function', scope: SCOPE });
    const make: MakeRender = new Function('ctx', 'rt', '_c', code.replace('return render(ctx, {});', 'return render;')) as MakeRender;
    return make(ctx, rt, { Icon: toComponent(IconMod as never) })(ctx, {});
  });
  document.body.appendChild(root);
  await tick();
  return {
    root,
    owner,
    dispose: (): void => {
      disposeOwner(owner);
      root.remove();
    },
  };
}

function dateField(initial: Date | null): DatepickerControl {
  return { value: signal<Date | null | undefined>(initial), touched: signal(false), error: (): string | null => null };
}
const field = (m: Mounted): HTMLElement => m.root.querySelector('.weave-datepicker__field') as HTMLElement;
const inputEl = (m: Mounted): HTMLInputElement => m.root.querySelector('.weave-datepicker__input') as HTMLInputElement;
const iconButton = (m: Mounted): HTMLButtonElement => m.root.querySelector('.weave-datepicker__icon-button') as HTMLButtonElement;
const inputKey = (m: Mounted, k: string): void => {
  inputEl(m).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
};
const panel = (): HTMLElement | null => document.body.querySelector('.weave-datepicker__panel');
const cells = (): HTMLButtonElement[] =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-datepicker__cell:not(.weave-datepicker__cell--blank)'));
const cellByText = (t: string): HTMLButtonElement =>
  cells().find((c) => (c.textContent ?? '') === t) as HTMLButtonElement;
const gridKey = (k: string, shift: boolean = false): void => {
  document.body
    .querySelector('.weave-datepicker__grid')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k, shiftKey: shift }));
};
const viewSwitch = (): HTMLButtonElement => document.body.querySelector('.weave-datepicker__view-switch') as HTMLButtonElement;
const yearGrid = (): HTMLElement | null => document.body.querySelector('.weave-datepicker__year-grid');
const monthGrid = (): HTMLElement | null => document.body.querySelector('.weave-datepicker__month-grid');
const yearCells = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-datepicker__year-cell'));
const monthCells = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.weave-datepicker__month-cell'));
const yearByText = (t: string): HTMLButtonElement => yearCells().find((c) => (c.textContent ?? '') === t) as HTMLButtonElement;
const monthByText = (t: string): HTMLButtonElement => monthCells().find((c) => (c.textContent ?? '') === t) as HTMLButtonElement;
const keyOn = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k }));
};
const weekdayTexts = (): string[] =>
  Array.from(document.body.querySelectorAll('.weave-datepicker__weekday')).map((e) => e.textContent ?? '');

const matchRe = (s: string, re: RegExp, msg?: string): void => assert.ok(re.test(s), msg ?? `${JSON.stringify(s)} matches ${re}`);

const JUN15: Date = A.create(2026, 5, 15);

/* ── field ── */
test('datepicker: the field icon is a lucide calendar <Icon> (not a CSS drawing)', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  const icon: Element | null = m.root.querySelector('.weave-datepicker__icon');
  assert.ok(icon?.querySelector('.weave-icon svg'), 'calendar renders a lucide svg');
  m.dispose();
});

test('datepicker: aria-controls on the field points at the open calendar panel (clears on close)', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  const f: HTMLElement = field(m);
  assert.equal(f.getAttribute('aria-controls'), null, 'no aria-controls while closed');
  f.click();
  await tick();
  const controls: string | null = f.getAttribute('aria-controls');
  assert.ok(controls, 'aria-controls set when open');
  assert.equal(panel()?.id, controls, 'points at the calendar panel id');
  f.click();
  await tick();
  assert.equal(f.getAttribute('aria-controls'), null, 'aria-controls cleared on close');
  m.dispose();
});

test('datepicker: renders a combobox field; the value formats via the adapter', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  const f: HTMLElement = field(m);
  assert.equal(f.getAttribute('role'), 'combobox');
  assert.equal(f.getAttribute('aria-haspopup'), 'dialog');
  matchRe(f.textContent ?? '', /Jun 15, 2026/);
  m.dispose();
});

test('datepicker: placeholder shows when empty', async () => {
  const m: Mounted = await mount({ control: dateField(null), placeholder: 'Pick a date', locale: 'en-US' });
  matchRe(field(m).textContent ?? '', /Pick a date/);
  assert.ok(m.root.querySelector('.weave-datepicker__value--placeholder'));
  m.dispose();
});

/* ── open + grid ── */
test('datepicker: clicking the field opens the calendar to the selected month; the day is marked', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  assert.equal(panel(), null, 'closed initially');
  field(m).click();
  assert.ok(panel(), 'calendar opened');
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /June 2026/);
  const sel: HTMLButtonElement = cellByText('15');
  assert.equal(sel.getAttribute('aria-selected'), 'true');
  assert.ok(sel.classList.contains('weave-datepicker__cell--selected'));
  assert.equal(field(m).getAttribute('aria-expanded'), 'true');
  m.dispose();
});

test('datepicker: clicking a day commits it + closes the panel', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  cellByText('20').click();
  assert.ok(ctl.value() && A.isSameDay(ctl.value() as Date, A.create(2026, 5, 20)), 'committed Jun 20');
  assert.equal(panel(), null, 'closed after select');
  matchRe(field(m).textContent ?? '', /Jun 20, 2026/);
  m.dispose();
});

/* ── min / max / filter ── */
test('datepicker: min/max disable out-of-range days', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, min: A.create(2026, 5, 10), max: A.create(2026, 5, 20), locale: 'en-US' });
  field(m).click();
  assert.equal(cellByText('5').disabled, true, 'before min disabled');
  assert.equal(cellByText('25').disabled, true, 'after max disabled');
  assert.equal(cellByText('15').disabled, false, 'in range enabled');
  cellByText('5').click(); // a disabled <button> dispatches no click → no commit, panel stays open
  assert.ok(panel(), 'still open after clicking a disabled day');
  assert.ok(A.isSameDay(ctl.value() as Date, JUN15), 'value unchanged');
  m.dispose();
});

test('datepicker: dateFilter disables specific days', async () => {
  // Disable weekends.
  const m: Mounted = await mount({
    control: dateField(JUN15),
    dateFilter: (d: Date): boolean => A.getDayOfWeek(d) !== 0 && A.getDayOfWeek(d) !== 6,
    locale: 'en-US',
  });
  field(m).click();
  // Jun 13 2026 is a Saturday, Jun 15 a Monday.
  assert.equal(cellByText('13').disabled, true, 'Saturday filtered out');
  assert.equal(cellByText('15').disabled, false, 'Monday allowed');
  m.dispose();
});

/* ── keyboard ── */
test('datepicker: arrow keys move day focus; Enter selects', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  gridKey('ArrowDown'); // 15 → 22
  gridKey('ArrowRight'); // 22 → 23
  gridKey('Enter');
  assert.ok(A.isSameDay(ctl.value() as Date, A.create(2026, 5, 23)), 'selected Jun 23 via keyboard');
  m.dispose();
});

test('datepicker: RTL flips day arrows — ArrowLeft = next day, ArrowRight = previous', async () => {
  setDirection('rtl');
  try {
    const ctl: DatepickerControl = dateField(JUN15);
    const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
    field(m).click();
    gridKey('ArrowLeft'); // RTL: next day → Jun 16
    gridKey('Enter');
    assert.ok(A.isSameDay(ctl.value() as Date, A.create(2026, 5, 16)), 'ArrowLeft moved forward to Jun 16 in RTL');
    m.dispose();
  } finally {
    setDirection('ltr');
  }
});

test('datepicker: PageDown moves a month; Shift+PageDown moves a year', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  gridKey('PageDown'); // → July 2026
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /July 2026/);
  gridKey('PageDown', true); // +1 year → July 2027
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /July 2027/);
  m.dispose();
});

test('datepicker: Escape closes + returns focus to the field', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  assert.ok(panel());
  gridKey('Escape');
  assert.equal(panel(), null);
  assert.equal(document.activeElement, field(m), 'focus returned to the trigger');
  m.dispose();
});

/* ── month nav buttons ── */
test('datepicker: ‹ / › step the visible month', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  (panel()!.querySelector('.weave-datepicker__nav-button') as HTMLButtonElement).click(); // ‹ prev
  matchRe(panel()!.querySelector('.weave-datepicker__month-label')!.textContent ?? '', /May 2026/);
  m.dispose();
});

/* ── clear ── */
test('datepicker: clearable × resets the value', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, clearable: true, locale: 'en-US' });
  const clear: HTMLButtonElement = m.root.querySelector('.weave-datepicker__clear') as HTMLButtonElement;
  assert.ok(clear, 'clear shown when a date is set');
  clear.click();
  assert.equal(ctl.value(), null);
  m.dispose();
});

/* ── value/onChange binding (no control) ── */
test('datepicker: value + onChange binding (uncontrolled forms convention)', async () => {
  let out: Date | null = null;
  const m: Mounted = await mount({ value: JUN15, onChange: (d) => (out = d), locale: 'en-US' });
  field(m).click();
  cellByText('1').click();
  assert.ok(out && A.isSameDay(out as Date, A.create(2026, 5, 1)));
  m.dispose();
});

/* ── editable (text entry via adapter.parse) ── */
test('datepicker: editable renders a typeable combobox input (not a value span)', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), editable: true, locale: 'en-US' });
  const inp: HTMLInputElement = inputEl(m);
  assert.ok(inp, 'an input field');
  assert.equal(inp.getAttribute('role'), 'combobox');
  assert.equal(field(m).hasAttribute('role'), false, 'the wrapper is no longer the combobox');
  matchRe(inp.value, /Jun 15, 2026/);
  assert.ok(!m.root.querySelector('.weave-datepicker__value'), 'no static value span in editable mode');
  m.dispose();
});

test('datepicker: typing a valid date + Enter parses + commits (via the adapter)', async () => {
  const ctl: DatepickerControl = dateField(null);
  const m: Mounted = await mount({ control: ctl, editable: true, locale: 'en-US' });
  inputEl(m).value = '2026-06-20'; // ISO fast-path
  inputKey(m, 'Enter');
  assert.ok(ctl.value() && A.isSameDay(ctl.value() as Date, A.create(2026, 5, 20)), 'committed Jun 20');
  matchRe(inputEl(m).value, /Jun 20, 2026/, 'normalised to the display format');
  m.dispose();
});

test('datepicker: typing an unparseable date flags aria-invalid + does not commit', async () => {
  const ctl: DatepickerControl = dateField(null);
  const m: Mounted = await mount({ control: ctl, editable: true, locale: 'en-US' });
  inputEl(m).value = 'not a date';
  inputKey(m, 'Enter');
  assert.equal(ctl.value(), null, 'no commit on junk');
  assert.equal(inputEl(m).getAttribute('aria-invalid'), 'true');
  assert.ok(m.root.classList.contains('weave-datepicker--invalid'), '--invalid class set on the root');
  m.dispose();
});

test('datepicker: editable — the icon button opens the calendar; ArrowDown opens too', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), editable: true, locale: 'en-US' });
  assert.equal(panel(), null);
  iconButton(m).click();
  assert.ok(panel(), 'icon opened the calendar');
  assert.equal(inputEl(m).getAttribute('aria-expanded'), 'true');
  cellByText('20').click(); // pick a day → fills the input
  matchRe(inputEl(m).value, /Jun 20, 2026/);
  assert.equal(panel(), null, 'closed after pick');
  inputKey(m, 'ArrowDown');
  assert.ok(panel(), 'ArrowDown reopened the calendar');
  m.dispose();
});

test('datepicker: editable — empty text on blur clears the value', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, editable: true, locale: 'en-US' });
  inputEl(m).value = '';
  inputEl(m).dispatchEvent(new FocusEvent('blur'));
  assert.equal(ctl.value(), null, 'blur with empty text clears');
  m.dispose();
});

/* ── multi-view drill-down: day → year → month → day ── */
test('datepicker: the day header is a button that opens the year grid (marks current + selected year)', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  const sw: HTMLButtonElement = viewSwitch();
  matchRe(sw.textContent ?? '', /June 2026/, 'day header shows month + year');
  assert.equal(sw.getAttribute('aria-label'), 'Choose year', 'header names the year action');
  sw.click();
  assert.ok(yearGrid(), 'year grid opened in the same panel');
  assert.equal(panel()!.querySelectorAll('.weave-datepicker__grid').length, 0, 'day grid replaced');
  // 2026 % 24 = 10 → the page runs 2016–2039.
  assert.ok(yearByText('2016') && yearByText('2039'), 'a 24-year page (2016–2039)');
  matchRe(document.body.querySelector('.weave-datepicker__range-label')!.textContent ?? '', /2016.*2039/);
  assert.equal(yearByText('2026').getAttribute('aria-selected'), 'true', 'selected value year marked');
  assert.equal(yearByText('2026').getAttribute('data-focused'), 'true', 'focus starts on the selected year');
  m.dispose();
});

test('datepicker: picking a year opens the month grid; picking a month opens that day calendar', async () => {
  const ctl: DatepickerControl = dateField(JUN15);
  const m: Mounted = await mount({ control: ctl, locale: 'en-US' });
  field(m).click();
  viewSwitch().click(); // → year grid
  yearByText('2030').click(); // → month grid for 2030
  assert.ok(monthGrid(), 'month grid opened');
  assert.equal(viewSwitch().textContent, '2030', 'month view header shows the chosen year');
  assert.equal(monthCells().length, 12, 'Jan–Dec');
  monthByText('Mar').click(); // → day calendar for March 2030
  assert.ok(document.body.querySelector('.weave-datepicker__grid'), 'back to the day grid');
  matchRe(viewSwitch().textContent ?? '', /March 2030/, 'day header now March 2030');
  cellByText('10').click(); // pick a day
  assert.ok(ctl.value() && A.isSameDay(ctl.value() as Date, A.create(2030, 2, 10)), 'committed Mar 10, 2030');
  assert.equal(panel(), null, 'panel closed after picking the day');
  m.dispose();
});

test('datepicker: month view header switches back to the year grid', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  yearByText('2028').click();
  assert.ok(monthGrid());
  viewSwitch().click(); // year button → back up to the year grid
  assert.ok(yearGrid(), 'returned to the year grid');
  assert.equal(monthGrid(), null, 'month grid replaced');
  m.dispose();
});

/* ── year-grid paging + keyboard ── */
test('datepicker: ‹ / › page the year grid by 24 years', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  (document.body.querySelectorAll('.weave-datepicker__nav-button')[1] as HTMLButtonElement).click(); // › next page
  assert.ok(yearByText('2040') && yearByText('2063'), 'jumped to 2040–2063');
  (document.body.querySelector('.weave-datepicker__nav-button') as HTMLButtonElement).click(); // ‹ back
  assert.ok(yearByText('2016'), 'back to 2016–2039');
  m.dispose();
});

test('datepicker: year grid — arrows move focus (row = 4), Enter opens that year’s month grid', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  keyOn(yearGrid()!, 'ArrowDown'); // 2026 → +4 → 2030
  assert.equal(yearByText('2030').getAttribute('data-focused'), 'true', 'ArrowDown moved a row (4 years)');
  keyOn(yearGrid()!, 'Enter');
  assert.ok(monthGrid(), 'Enter drilled into the month grid');
  assert.equal(viewSwitch().textContent, '2030');
  m.dispose();
});

test('datepicker: month grid — arrows move focus (row = 3), Enter opens that month’s day calendar', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  yearByText('2026').click(); // month grid, focus starts on June (index 5)
  keyOn(monthGrid()!, 'ArrowDown'); // 5 → +3 → 8 (September)
  assert.equal(monthByText('Sep').getAttribute('data-focused'), 'true', 'ArrowDown moved a row (3 months)');
  keyOn(monthGrid()!, 'Enter');
  matchRe(viewSwitch().textContent ?? '', /September 2026/, 'Enter opened September 2026');
  m.dispose();
});

/* ── first day of week (default Monday, configurable) ── */
test('datepicker: first day of week defaults to Monday', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), locale: 'en-US' });
  field(m).click();
  assert.equal(weekdayTexts()[0], 'M', 'header starts on Monday by default');
  assert.equal(weekdayTexts()[6], 'S', 'and ends on Sunday');
  m.dispose();
});

test('datepicker: firstDayOfWeek is configurable (0 = Sunday)', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), firstDayOfWeek: 0, locale: 'en-US' });
  field(m).click();
  assert.equal(weekdayTexts()[0], 'S', 'Sunday-first when firstDayOfWeek=0');
  assert.equal(weekdayTexts()[1], 'M');
  m.dispose();
});

test('datepicker: firstDayOfWeek shifts the leading blanks (Jun 1 2026 is a Monday)', async () => {
  // Monday-first: Jun 1 (a Monday) is the first cell — no leading blanks.
  const mon: Mounted = await mount({ control: dateField(JUN15), firstDayOfWeek: 1, locale: 'en-US' });
  field(mon).click();
  const firstCellMon: Element = document.body.querySelector('.weave-datepicker__grid .weave-datepicker__cell')!;
  assert.ok(!firstCellMon.classList.contains('weave-datepicker__cell--blank'), 'Monday-first: no lead blank before Jun 1');
  assert.equal(firstCellMon.textContent, '1');
  mon.dispose();
  // Sunday-first: one leading blank (Sun) before Monday Jun 1.
  const sun: Mounted = await mount({ control: dateField(JUN15), firstDayOfWeek: 0, locale: 'en-US' });
  field(sun).click();
  const firstCellSun: Element = document.body.querySelector('.weave-datepicker__grid .weave-datepicker__cell')!;
  assert.ok(firstCellSun.classList.contains('weave-datepicker__cell--blank'), 'Sunday-first: a lead blank before Jun 1');
  sun.dispose();
});

/* ── i18n: translatable chrome labels ── */
test('datepicker: labels override the calendar chrome strings (nav, view switch, dialog)', async () => {
  const m: Mounted = await mount({
    control: dateField(JUN15),
    locale: 'en-US',
    labels: {
      prevMonth: 'Ankstesnis mėnuo',
      nextMonth: 'Kitas mėnuo',
      chooseYear: 'Rinktis metus',
      calendarLabel: 'Pasirinkite datą',
      prevYearRange: 'Ankstesni metai',
    },
  });
  field(m).click();
  assert.equal(panel()!.getAttribute('aria-label'), 'Pasirinkite datą', 'dialog name translated');
  const navs: NodeListOf<HTMLButtonElement> = document.body.querySelectorAll('.weave-datepicker__nav-button');
  assert.equal(navs[0].getAttribute('aria-label'), 'Ankstesnis mėnuo', 'prev month translated');
  assert.equal(navs[1].getAttribute('aria-label'), 'Kitas mėnuo', 'next month translated');
  assert.equal(viewSwitch().getAttribute('aria-label'), 'Rinktis metus', 'year switch translated');
  viewSwitch().click();
  assert.equal(
    (document.body.querySelector('.weave-datepicker__nav-button') as HTMLButtonElement).getAttribute('aria-label'),
    'Ankstesni metai',
    'year-range nav translated'
  );
  m.dispose();
});

test('datepicker: labels.clear + labels.openCalendar translate the field buttons', async () => {
  const m: Mounted = await mount({
    control: dateField(JUN15),
    clearable: true,
    editable: true,
    locale: 'en-US',
    labels: { clear: 'Išvalyti', openCalendar: 'Atverti kalendorių' },
  });
  assert.equal((m.root.querySelector('.weave-datepicker__clear') as HTMLElement).getAttribute('aria-label'), 'Išvalyti');
  assert.equal(iconButton(m).getAttribute('aria-label'), 'Atverti kalendorių');
  m.dispose();
});

/* ── min/max in the year + month grids ── */
test('datepicker: years fully outside min/max are disabled in the year grid', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), min: A.create(2020, 0, 1), max: A.create(2030, 11, 31), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  assert.equal(yearByText('2019').disabled, true, 'before min year disabled');
  assert.equal(yearByText('2031').disabled, true, 'after max year disabled');
  assert.equal(yearByText('2025').disabled, false, 'in-range year enabled');
  m.dispose();
});

test('datepicker: months fully outside min/max are disabled in the month grid', async () => {
  const m: Mounted = await mount({ control: dateField(JUN15), min: A.create(2026, 5, 10), max: A.create(2026, 5, 20), locale: 'en-US' });
  field(m).click();
  viewSwitch().click();
  yearByText('2026').click();
  assert.equal(monthByText('May').disabled, true, 'May (entirely before min) disabled');
  assert.equal(monthByText('Jul').disabled, true, 'July (entirely after max) disabled');
  assert.equal(monthByText('Jun').disabled, false, 'June (has selectable days) enabled');
  m.dispose();
});
