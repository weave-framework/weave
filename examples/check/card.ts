// A child component with a typed prop contract — `setup`'s first parameter.
// A parent that imports it has its `<Card …>` props checked against this.
export interface CardProps {
  label: string;
  count: number;
}

export function setup(props: CardProps) {
  const label = (): string => props.label;
  const count = (): number => props.count;
  return { label, count };
}
