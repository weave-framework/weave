import ApiPage from '../../lib/api-page/api-page';

void ApiPage;

interface PkgRefSetup {
  pkg: () => string;
}

/** Reference → a package's generated API (route `/reference/:pkg`). One dynamic
 *  page serves every package; the content comes from `api.gen.ts`. */
export function setup(props: { params: { pkg: string } }): PkgRefSetup {
  return { pkg: () => props.params.pkg };
}
