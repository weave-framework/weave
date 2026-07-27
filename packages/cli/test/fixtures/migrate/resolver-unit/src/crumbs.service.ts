import { Injectable } from '@angular/core';
import { CrumbsResolver } from './crumbs.resolver';

// The other half of the defect: a converted file that goes on naming the resolver by its CLASS name. The
// resolver was in the "already handled" set but in no symbol table, so this import was never repointed and the
// bundler stopped at "no matching export" — an error the type-check could not attribute to anything.
@Injectable({ providedIn: 'root' })
export class CrumbsService {
  private fallback = new CrumbsResolver();

  first(route: { path: string }): string {
    return this.fallback.resolve(route)[0];
  }
}
