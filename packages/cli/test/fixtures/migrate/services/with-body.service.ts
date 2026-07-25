import { Injectable } from '@angular/core';

// A service whose methods have real bodies — the draft must carry them across, not throw them away.
@Injectable({ providedIn: 'root' })
export class WithBodyService {
  count = 0;

  apply(n: number): void {
    this.count = n;
    this.recompute();
  }

  private recompute(): void {}
}
