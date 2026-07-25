import { Injectable, signal, Signal, WritableSignal } from '@angular/core';

// Scoped service: no providedIn (must be listed in a component/module provider) → providedIn is null, not guessed.
// Its whole public surface is a SIGNAL field, not a method — a real shape that read as "0 public API" until
// public fields were counted. `state` is signal-typed, `items` is signal-initialised: both map 1:1 to Weave.
@Injectable()
export class ScopedService {
  public state: WritableSignal<number> = signal(0);
  public items = signal<string[]>([]); // signal ONLY by its initializer (no type annotation)
  public declared!: Signal<number>; // signal ONLY by its type (no initializer) — each path must stand alone
  public label = 'plain'; // a public field that is NOT a signal
  private hidden = signal(0); // private → not part of the surface

  doThing(): void {}
}
