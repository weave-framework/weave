// A barrel, the way a real interfaces library is written: `export *` over everything. Walking a unit from its
// entry therefore reaches EVERY file — which is why importing one type used to migrate the whole library.
export * from './lib/user';
export * from './lib/order';
export * from './lib/invoice';
export * from './lib/address';
export * from './lib/payment';
export * from './lib/shipment';
