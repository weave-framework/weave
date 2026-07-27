import { Injectable, NgZone } from '@angular/core';

// A service whose methods have real bodies — the draft must carry them across, not throw them away.
@Injectable({ providedIn: 'root' })
export class WithBodyService {
  count = 0;

  // The dependency declared as a CONSTRUCTOR PARAMETER, Angular's most common form, and one Weave does not
  // provide. The constructor READS it, and a constructor body runs on creation — so the draft cannot leave that
  // read live against the hole it declares for it.
  constructor(private zone: NgZone) {
    this.zone.run(() => {
      this.count = 1;
    });
  }

  apply(n: number): void {
    this.count = n;
    this.recompute();
  }

  private recompute(): void {}
}
