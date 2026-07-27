import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';

// Everything the RxJS translation has to face in one class: a Subject that IS a signal, a chain that folds into
// array methods, and a chain that does NOT fold because its operator is about time.
@Injectable({ providedIn: 'root' })
export class StreamsService {
  private open = new BehaviorSubject<boolean>(false);

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
