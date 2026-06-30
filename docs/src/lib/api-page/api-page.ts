import CodeBlock from '../code-block/code-block';
import { api, apiTitles, type ApiSymbol } from '../../content/api.gen';

void CodeBlock;

interface ApiPageProps {
  /** Package key, e.g. 'runtime' (the `:pkg` route param). */
  pkg?: string;
}

interface ApiPageSetup {
  title: () => string;
  symbols: () => ApiSymbol[];
  count: () => number;
  notFound: () => boolean;
}

/** Renders a package's generated API reference (signatures + TSDoc + params).
 *  Driven by the `pkg` prop so one dynamic route serves every package. */
export function setup(props: ApiPageProps): ApiPageSetup {
  const key = (): string => props.pkg ?? '';
  const symbols = (): ApiSymbol[] => api[key()] ?? [];
  const title = (): string => apiTitles[key()] ?? key();
  const count = (): number => symbols().length;
  const notFound = (): boolean => !(key() in api);
  return { title, symbols, count, notFound };
}
