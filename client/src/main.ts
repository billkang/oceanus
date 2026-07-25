import { bootstrapApplication } from '@angular/platform-browser';
import { init } from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

if (environment.glitchtipDsn) {
  init({
    dsn: environment.glitchtipDsn,
    environment: environment.production ? 'production' : 'development',
  });
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
