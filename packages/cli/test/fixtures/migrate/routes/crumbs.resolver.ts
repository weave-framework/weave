import { ActivatedRouteSnapshot } from '@angular/router';
import { Observable, of } from 'rxjs';

// A route resolver carries NO decorator, so it used to fall through as "plain TypeScript, carried as-is" — a
// file full of ActivatedRouteSnapshot moved unchanged, under a banner saying most of it already works. It does
// not work: nothing in Weave will ever call it. Weave's counterpart is a route `loader`.
export class CrumbsResolver {
  resolve(route: ActivatedRouteSnapshot): Observable<string[]> {
    return of([route.routeConfig.path ?? '']);
  }

  helper(): number {
    return 1;
  }
}

// Not a resolver: the method takes no arguments, so it is somebody else's `resolve`.
export class PromiseLike {
  resolve(): void {}
}
