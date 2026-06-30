import Card from './card';

// `<Card>` is referenced in the template; the harness reads `typeof Card`, so the
// import is live (no need for a `void Card`).
export function setup() {
  const items = (): { label: string; count: number }[] => [{ label: 'a', count: 1 }];
  return { items };
}
