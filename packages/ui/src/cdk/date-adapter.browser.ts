import { test, assert } from '../../../../tools/harness.js';
import { createDateAdapter, type DateAdapter } from '@weave-framework/ui/cdk';

// A fixed en-US adapter → deterministic parse order (month/day/year) + names, regardless of env.
const a: DateAdapter = createDateAdapter({ locale: 'en-US' });

/* ── create / accessors ── */
test('date-adapter: create makes a local-midnight date; accessors read it back', () => {
  const d: Date = a.create(2026, 6, 2); // 2 Jul 2026 (month 0-based)
  assert.equal(a.getYear(d), 2026);
  assert.equal(a.getMonth(d), 6);
  assert.equal(a.getDate(d), 2);
  assert.equal(d.getHours(), 0, 'midnight');
});

/* ── days in month + leap years ── */
test('date-adapter: getDaysInMonth handles month lengths + leap years', () => {
  assert.equal(a.getDaysInMonth(a.create(2021, 0, 1)), 31, 'Jan');
  assert.equal(a.getDaysInMonth(a.create(2021, 3, 1)), 30, 'Apr');
  assert.equal(a.getDaysInMonth(a.create(2021, 1, 1)), 28, 'Feb non-leap');
  assert.equal(a.getDaysInMonth(a.create(2020, 1, 1)), 29, 'Feb leap');
  assert.equal(a.getDaysInMonth(a.create(2000, 1, 1)), 29, 'Feb 2000 (÷400 leap)');
  assert.equal(a.getDaysInMonth(a.create(1900, 1, 1)), 28, 'Feb 1900 (÷100 not leap)');
});

/* ── arithmetic + overflow clamp ── */
test('date-adapter: addDays steps across month/year boundaries (DST-safe)', () => {
  assert.ok(a.isSameDay(a.addDays(a.create(2021, 0, 31), 1), a.create(2021, 1, 1)), 'Jan31 +1 → Feb1');
  assert.ok(a.isSameDay(a.addDays(a.create(2021, 11, 31), 1), a.create(2022, 0, 1)), 'Dec31 +1 → next year');
  assert.ok(a.isSameDay(a.addDays(a.create(2021, 0, 1), -1), a.create(2020, 11, 31)), 'back across the year');
});

test('date-adapter: addMonths / addYears clamp the day to the target month length', () => {
  assert.ok(a.isSameDay(a.addMonths(a.create(2021, 0, 31), 1), a.create(2021, 1, 28)), 'Jan31 +1mo → Feb28');
  assert.ok(a.isSameDay(a.addMonths(a.create(2020, 0, 31), 1), a.create(2020, 1, 29)), 'Jan31 +1mo (leap) → Feb29');
  assert.ok(a.isSameDay(a.addYears(a.create(2020, 1, 29), 1), a.create(2021, 1, 28)), 'Feb29 +1yr → Feb28');
  assert.ok(a.isSameDay(a.addMonths(a.create(2021, 10, 15), 3), a.create(2022, 1, 15)), 'crosses the year');
});

/* ── start/end of month ── */
test('date-adapter: startOfMonth / endOfMonth', () => {
  const mid: Date = a.create(2021, 1, 15);
  assert.ok(a.isSameDay(a.startOfMonth(mid), a.create(2021, 1, 1)));
  assert.ok(a.isSameDay(a.endOfMonth(mid), a.create(2021, 1, 28)));
});

/* ── compare / same-day / clamp ── */
test('date-adapter: compare + isSameDay ignore the time component', () => {
  const d1: Date = a.create(2026, 6, 2);
  const d2: Date = new Date(2026, 6, 2, 18, 30); // same day, later time
  assert.equal(a.compare(d1, d2), 0);
  assert.ok(a.isSameDay(d1, d2));
  assert.equal(a.compare(a.create(2026, 6, 1), a.create(2026, 6, 2)), -1);
  assert.equal(a.compare(a.create(2026, 6, 3), a.create(2026, 6, 2)), 1);
});

test('date-adapter: clamp bounds a date into [min, max]', () => {
  const min: Date = a.create(2026, 0, 1);
  const max: Date = a.create(2026, 11, 31);
  assert.ok(a.isSameDay(a.clamp(a.create(2025, 5, 1), min, max), min), 'below → min');
  assert.ok(a.isSameDay(a.clamp(a.create(2027, 5, 1), min, max), max), 'above → max');
  assert.ok(a.isSameDay(a.clamp(a.create(2026, 5, 1), min, max), a.create(2026, 5, 1)), 'inside → unchanged');
});

/* ── parse (ISO + locale numeric) + reject overflow ── */
test('date-adapter: parse — ISO fast-path', () => {
  const d: Date | null = a.parse('2026-07-02');
  assert.ok(d && a.isSameDay(d, a.create(2026, 6, 2)));
});

test('date-adapter: parse — en-US numeric order (month/day/year) + 2-digit year', () => {
  assert.ok(a.isSameDay(a.parse('11/22/2017')!, a.create(2017, 10, 22)));
  assert.ok(a.isSameDay(a.parse('3/4/21')!, a.create(2021, 2, 4)), '2-digit year → 2021');
});

test('date-adapter: parse — rejects overflow + junk (no silent normalise)', () => {
  assert.equal(a.parse('2/30/2021'), null, 'Feb 30 rejected (would roll to Mar 2)');
  assert.equal(a.parse('13/1/2021'), null, 'month 13 rejected');
  assert.equal(a.parse('not a date'), null);
  assert.equal(a.parse(''), null);
});

test('date-adapter: format ↔ parse round-trips in the locale numeric format', () => {
  const d: Date = a.create(2026, 6, 2);
  const text: string = a.format(d, { year: 'numeric', month: '2-digit', day: '2-digit' }); // "07/02/2026"
  const back: Date | null = a.parse(text);
  assert.ok(back && a.isSameDay(back, d), `round-trip via "${text}"`);
});

/* ── locale calendar helpers ── */
test('date-adapter: firstDayOfWeek — locale-derived + override', () => {
  assert.equal(a.firstDayOfWeek(), 0, 'en-US starts on Sunday');
  const mon: DateAdapter = createDateAdapter({ locale: 'en-US', firstDayOfWeek: 1 });
  assert.equal(mon.firstDayOfWeek(), 1, 'override wins');
});

test('date-adapter: weekday + month names (JS order)', () => {
  const days: string[] = a.getDayOfWeekNames('short');
  assert.equal(days.length, 7);
  assert.equal(days[0], 'Sun', 'index 0 = Sunday');
  assert.equal(days[6], 'Sat');
  const months: string[] = a.getMonthNames('long');
  assert.equal(months.length, 12);
  assert.equal(months[0], 'January');
  assert.equal(months[11], 'December');
});
