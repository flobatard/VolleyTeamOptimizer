import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { OAuthService } from 'angular-oauth2-oidc';
import { buildAuthConfig } from './auth.config';

/**
 * Encapsule `OAuthService` (angular-oauth2-oidc) pour le flux OIDC ZITADEL.
 *
 * SSR : toute interaction avec la lib (qui dépend de `window`/`crypto`/`sessionStorage`)
 * est gardée par `isPlatformBrowser`. Côté serveur, le service est un no-op.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly oauth = inject(OAuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _isAuthenticated = signal(false);
  private readonly _userProfile = signal<Record<string, unknown> | null>(null);

  readonly isAuthenticated = this._isAuthenticated.asReadonly();
  readonly userProfile = this._userProfile.asReadonly();

  /** Nom affichable extrait des claims OIDC, ou null. */
  readonly displayName = computed(() => {
    const claims = this._userProfile();
    if (!claims) return null;
    return (claims['name'] ?? claims['preferred_username'] ?? claims['email'] ?? null) as
      | string
      | null;
  });

  /**
   * Amorce l'authentification : configure le client, charge le discovery document
   * et tente de finaliser un éventuel retour de redirection (code flow).
   * Appelé via `provideAppInitializer`. No-op côté serveur.
   */
  async init(): Promise<void> {
    if (!this.isBrowser) return;

    this.oauth.configure(buildAuthConfig());

    try {
      await this.oauth.loadDiscoveryDocumentAndTryLogin();
      this.oauth.setupAutomaticSilentRefresh();
    } catch (error) {
      // Discovery indisponible (ZITADEL down / mauvaise URL) : on n'empêche pas le boot de l'app.
      console.error('OIDC: échec du chargement du discovery document', error);
    }

    this.syncState();
  }

  /** Lance le flux de connexion (redirection vers ZITADEL). */
  login(): void {
    if (!this.isBrowser) return;
    this.oauth.initLoginFlow();
  }

  /** Déconnecte et redirige vers le endpoint de logout du provider. */
  logout(): void {
    if (!this.isBrowser) return;
    this.oauth.logOut();
    this.syncState();
  }

  /** Token d'accès courant (chaîne vide si non connecté). */
  accessToken(): string {
    return this.isBrowser ? this.oauth.getAccessToken() : '';
  }

  private syncState(): void {
    const valid = this.oauth.hasValidAccessToken();
    this._isAuthenticated.set(valid);
    this._userProfile.set(valid ? this.oauth.getIdentityClaims() : null);
  }
}
