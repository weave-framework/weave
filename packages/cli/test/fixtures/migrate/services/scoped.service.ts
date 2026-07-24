import { Injectable } from '@angular/core';

// Scoped service: no providedIn (must be listed in a component/module provider) → providedIn is null, not guessed.
@Injectable()
export class ScopedService {
  doThing(): void {}
}
