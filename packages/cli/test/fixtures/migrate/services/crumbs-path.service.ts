import { Injectable, inject } from '@angular/core';
import { CrumbsService } from './crumbs.service';

// It calls a service THIS migration converts. Saying "no recorded Weave equivalent — migrate CrumbsService
// first" asked for work already happening, about a call that was already correct — and the field itself came
// out as a comment, so every call through it named nothing.
@Injectable({ providedIn: 'root' })
export class CrumbsPathService {
  private _CrumbsService: CrumbsService = inject(CrumbsService);
  loaded: boolean = false;

  refresh(): void {
    if (this._CrumbsService.crumbsSig().length > 0) {
      this.loaded = true;
    }
  }
}
