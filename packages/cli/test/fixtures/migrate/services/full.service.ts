import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

// The shape that exposed the bug: the real work lives in the CONSTRUCTOR and in a PRIVATE helper, while the
// public surface is almost empty. Analysing only public members reported "0 methods" and dropped all of it.
@Injectable({ providedIn: 'root' })
export class FullService {
  private router = inject(Router);
  private secret = 42;
  public visible = 'shown';

  constructor() {
    this.router.events.subscribe(() => {
      this.hiddenHelper(this.secret);
    });
  }

  private hiddenHelper(n: number): void {
    this.secret = n + 1;
  }

  ngOnDestroy(): void {
    this.secret = 0;
  }
}
