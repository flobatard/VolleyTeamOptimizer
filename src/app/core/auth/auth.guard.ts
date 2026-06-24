import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Protège les routes nécessitant une authentification OIDC.
 *
 * - Côté serveur (SSR) : laisse passer (`true`) pour permettre le rendu ; la vérification
 *   réelle a lieu côté client après hydratation. Acceptable pour cet outil interne.
 * - Côté navigateur : autorise si un token valide existe, sinon déclenche le flux de login
 *   (redirection ZITADEL) et bloque la navigation.
 */
export const authGuard: CanActivateFn = () => {
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  if (!isBrowser) return true;

  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;

  auth.login();
  return false;
};
