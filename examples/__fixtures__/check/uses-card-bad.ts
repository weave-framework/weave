import Card from './card';

export function setup() {
  const items = (): { label: string; count: number }[] => [{ label: 'a', count: 1 }];
  return { items };
}
