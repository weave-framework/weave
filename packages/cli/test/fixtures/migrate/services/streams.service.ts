import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';

// Everything the RxJS translation has to face in one class: a Subject that IS a signal, a chain that folds into
// array methods, and a chain that does NOT fold because its operator is about time.
@Injectable({ providedIn: 'root' })
export class StreamsService {
  private open = new BehaviorSubject<boolean>(false);
  private _router: Router = inject(Router);

  // The alias the source wrote for `this.`, and a read of the service itself. Angular's `navigate` is rewritten
  // to Weave's, but `_router.url` is not — so the field has to survive, and the alias has to not.
  constructor() {
    const _router: Router = this._router;
    this._router.navigate(['/x']);
    this.open.next(_router.url.length > 0);
  }

  toggle(): void {
    this.open.next(!this.open.value);
  }

  lengths(xs: string[]): Observable<number[]> {
    return of(xs).pipe(map((v) => v.map((s) => s.length)));
  }

  settled(src: Observable<string>): Observable<string> {
    return src.pipe(debounceTime(300), map((s) => s.trim()));
  }
}
