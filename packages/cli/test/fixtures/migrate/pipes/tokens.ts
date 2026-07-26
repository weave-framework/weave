import { InjectionToken } from '@angular/core';

// An InjectionToken injects a VALUE rather than a class — Weave does that with a context.
export const APP_CONFIG = new InjectionToken<{ apiUrl: string }>('app.config');
