import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ErrorToastComponent } from './notifications/error-toast.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ErrorToastComponent],
  standalone: true,
  template: `
    <router-outlet />
    <app-error-toast />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
