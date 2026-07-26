import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsService } from '@sps-analytics';

// `AnalyticsService` has no class anywhere this walk goes — its methods are what this body CALLS, so without it
// every one of those calls is a guess. `Router` is Angular's own and has a recorded answer, so it is NOT a gap.
@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(
    private analytics: AnalyticsService,
    private router: Router,
  ) {}

  logout(): void {
    this.analytics.track('logout');
    this.router.navigate(['/login']);
  }
}
