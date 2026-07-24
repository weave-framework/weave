import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DashComponent } from './dash.component';
import { RoleGuard } from './role.guard';

// The classic NgModule form: RouterModule.forRoot([...]) with a guarded route.
@NgModule({
  imports: [RouterModule.forRoot([{ path: 'dash', component: DashComponent, canActivate: [RoleGuard] }])],
})
export class AppRoutingModule {}
