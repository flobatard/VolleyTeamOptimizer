import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import {
  provideClientHydration,
  withEventReplay,
  withNoIncrementalHydration,
} from '@angular/platform-browser';
import { provideOAuthClient } from 'angular-oauth2-oidc';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay(), withNoIncrementalHydration()),
    provideHttpClient(withInterceptorsFromDi()),
    // L'intercepteur de la lib attache le bearer token uniquement aux appels vers le backend.
    provideOAuthClient({
      resourceServer: {
        sendAccessToken: true,
        allowedUrls: [environment.backendUrl],
      },
    }),
    // Amorce l'auth au démarrage (no-op côté serveur).
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
