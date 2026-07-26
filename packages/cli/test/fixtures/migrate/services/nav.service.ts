import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';

// A constructor that DOES something — the shape a real service has. Its body was the one body the converter
// never translated: it came out as a TODO over a commented original while every other member was rewritten.
@Injectable({ providedIn: 'root' })
export class NavService {
  private _Router: Router = inject(Router);
  loaded: boolean = false;

  constructor() {
    this._Router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.loaded = true;
        this.doChanges();
      });
  }

  doChanges(): void {}
}
