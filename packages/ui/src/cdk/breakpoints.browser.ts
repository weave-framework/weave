import { test, assert } from '../../../../tools/harness.js';
import { effect } from '@weave-framework/runtime';
import { breakpointSignal, matchesBreakpoint, Breakpoints } from '@weave-framework/ui/cdk';

interface FakeMQL {
  matches: boolean;
  media: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  _emit(v: boolean): void;
}
function fakeMQL(initial: boolean): FakeMQL {
  const fns = new Set<() => void>();
  return {
    matches: initial,
    media: '',
    addEventListener: (_t, fn) => fns.add(fn),
    removeEventListener: (_t, fn) => fns.delete(fn),
    _emit(v: boolean) {
      this.matches = v;
      fns.forEach((fn) => fn());
    },
  };
}

test('breakpointSignal: reflects the initial match and reacts to changes', () => {
  const mql = fakeMQL(false);
  const original = window.matchMedia;
  (window as unknown as { matchMedia: (q: string) => FakeMQL }).matchMedia = () => mql;
  try {
    const narrow = breakpointSignal('(max-width: 899px)');
    const seen: boolean[] = [];
    const stop = effect(() => {
      seen.push(narrow());
    });
    assert.equal(narrow(), false, 'initial');
    mql._emit(true);
    assert.equal(narrow(), true, 'reacted to the media change');
    stop();
    assert.deepEqual(seen, [false, true], 'effect tracked the crossing');
  } finally {
    window.matchMedia = original;
  }
});

test('matchesBreakpoint: non-reactive snapshot against real matchMedia', () => {
  assert.equal(matchesBreakpoint('(min-width: 0px)'), true, 'always-true query');
  assert.equal(matchesBreakpoint('(max-width: 0px)'), false, 'always-false query');
});

test('Breakpoints: Keyline narrow preset is 900px', () => {
  assert.equal(Breakpoints.Narrow, '(max-width: 899px)');
  assert.equal(Breakpoints.Wide, '(min-width: 900px)');
});
