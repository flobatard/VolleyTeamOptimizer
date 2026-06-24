import { AuthConfig } from 'angular-oauth2-oidc';
import { environment } from '../../../environments/environment';

/**
 * Construit la configuration du client OIDC (ZITADEL) à partir de l'environnement.
 * Appelée uniquement côté navigateur (utilise `window.location.origin`).
 */
export function buildAuthConfig(): AuthConfig {
  const origin = window.location.origin;
  return {
    issuer: environment.oidc.issuer,
    clientId: environment.oidc.clientId,
    responseType: environment.oidc.responseType, // 'code' (Authorization Code + PKCE)
    scope: environment.oidc.scope,
    redirectUri: origin + '/',
    postLogoutRedirectUri: origin + '/',
    // PKCE est activé d'office par la lib pour le flux 'code' sur clientId public.
    // En prod/preprod on impose HTTPS ; en dev (localhost) on l'assouplit.
    requireHttps: environment.production ? 'remoteOnly' : false,
    // ZITADEL expose un discovery document conforme.
    strictDiscoveryDocumentValidation: true,
    showDebugInformation: !environment.production,
  };
}
