import { test, assert } from '../../../../tools/harness.js';
import { signal, effect, type Signal, type Computed } from '@weave-framework/runtime';
import { ArrayDataSource, isDataSource, type DataSource } from '@weave-framework/ui/cdk';

interface Row {
  id: number;
}

test('ArrayDataSource(static array): connect() yields the rows', () => {
  const rows: Row[] = [{ id: 1 }, { id: 2 }];
  const ds: DataSource<Row> = new ArrayDataSource<Row>(rows);
  const view: Computed<Row[]> = ds.connect();
  assert.deepEqual(view(), rows);
  ds.disconnect(); // no-op, must not throw
  assert.deepEqual(view(), rows, 'still readable after disconnect');
});

test('ArrayDataSource(signal): reactive updates propagate through connect()', () => {
  const src: Signal<Row[]> = signal<Row[]>([{ id: 1 }]);
  const ds: DataSource<Row> = new ArrayDataSource<Row>(src);
  const view: Computed<Row[]> = ds.connect();

  let seen: number = -1;
  const stop: () => void = effect(() => {
    seen = view().length;
  });
  assert.equal(seen, 1);
  src.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(seen, 3, 'view tracked the source signal');
  stop();
});

test('the returned view is read-only (a plain getter, not the writable signal)', () => {
  const ds: DataSource<Row> = new ArrayDataSource<Row>([{ id: 1 }]);
  const view: Computed<Row[]> = ds.connect();
  assert.equal(typeof view, 'function');
  assert.equal(typeof (view as unknown as { set?: unknown }).set, 'undefined', 'no set() exposed');
});

test('isDataSource: true for a DataSource, false for a raw array / signal', () => {
  const ds: DataSource<Row> = new ArrayDataSource<Row>([{ id: 1 }]);
  assert.ok(isDataSource(ds));
  assert.ok(!isDataSource([{ id: 1 }]));
  assert.ok(!isDataSource(signal<Row[]>([])));
  assert.ok(!isDataSource(null));
  assert.ok(!isDataSource(undefined));
});
