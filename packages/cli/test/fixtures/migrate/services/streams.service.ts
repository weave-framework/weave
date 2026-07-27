import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';

// Everything the RxJS translation has to face in one class: a Subject that IS a signal, a chain that folds into
// array methods, and a chain that does NOT fold because its operator is about time.
@Injectable({ providedIn: 'root' })
export class StreamsService {
  private open = new BehaviorSubject<boolean>(false);
  private _router: Router = inject(Router);
  // A field that was ALREADY a signal, derived. Nothing about it is a getter, so every hand-kept "import
  // `computed` if some member is a getter" rule read straight past it and the draft named it unimported.
  readonly count = signal(0);
  readonly doubled = computed(() => this.count() * 2);
  // Angular's read-only VIEW of a writable signal. Weave has no `asReadonly`, and left alone this passed the
  // type-check and threw `asReadonly is not a function` the moment the service was created.
  readonly countPublic = this.count.asReadonly();

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
