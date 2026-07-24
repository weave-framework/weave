import { Component } from '@angular/core';
import { FormGroup, FormControl, FormBuilder } from '@angular/forms';

@Component({ selector: 'app-login', standalone: true, template: '' })
export class LoginComponent {
  // Direct construction: control keys are readable from the object literal.
  form = new FormGroup({
    email: new FormControl(''),
    password: new FormControl(''),
  });

  constructor(private fb: FormBuilder) {}

  // FormBuilder form: keys readable from fb.group({...}).
  profile = this.fb.group({
    name: [''],
    age: [0],
  });
}
