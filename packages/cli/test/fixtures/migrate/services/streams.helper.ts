import { Observable, of, from } from 'rxjs';

// No decorator, so this file is CARRIED — which used to mean "moved with its streams intact". A helper module is
// exactly where the streams hide, so the carried path has to translate too.
export function toStream<T>(v: T): Observable<T> {
  return of(v);
}

export function fromPromise<T>(p: Promise<T>): Observable<T> {
  return from(p);
}
