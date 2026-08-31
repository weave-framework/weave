import { useCart } from './store-shared';

/**
 * A panel. It imports the store hook and calls it — nothing else connects it to its siblings, and there
 * is no provider above it. Calling `useCart()` IS the connection.
 */
interface PanelProps {
  where: string;
}

export function setup(props: PanelProps) {
  const cart = useCart();
  const where = (): string => props.where;
  const addOne = (): void => {
    cart.add(`item ${cart.total() + 1}`);
  };
}
