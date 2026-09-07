import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { OneService } from '@fx/one';

@Component({ selector: 'fx-solo', template: '<p>solo</p>' })
export class SoloComponent {
  constructor(
    private readonly one: OneService,
    private readonly router: Router,
  ) {}
}
