import { Component } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';

@Component({ selector: 'app-login', standalone: true, template: '' })
export class LoginComponent {
  form = new FormGroup({
    email: new FormControl(''),
    password: new FormControl(''),
  });
}
