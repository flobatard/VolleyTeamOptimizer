/**
 * Forme commune des fichiers d'environnement. Garantit que dev/preprod/prod
 * exposent exactement les mêmes clés (évite la dérive entre environnements).
 */
export interface AppEnvironment {
  production: boolean;
  name: 'dev' | 'preprod' | 'prod';

  /** URL racine de l'API backend (repo séparé). Ex: https://api.dev.volley.fbatard.fr */
  backendUrl: string;

  /** Configuration du client OIDC (provider ZITADEL, instance gérée hors repo). */
  oidc: {
    /** URL de l'instance ZITADEL. Discovery: `${issuer}/.well-known/openid-configuration` */
    issuer: string;
    /** clientId de l'application "User Agent / PKCE" déclarée dans ZITADEL. */
    clientId: string;
    /** Scopes demandés. Ex: 'openid profile email offline_access' */
    scope: string;
    /** Flux Authorization Code + PKCE. */
    responseType: 'code';
  };
}
