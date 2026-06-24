import { AppEnvironment } from './app-environment';

/**
 * Environnement PROD (build via `ng build --configuration=production`, configuration par défaut).
 * ⚠️ Valeurs à renseigner avec votre instance ZITADEL et votre backend de prod.
 */
export const environment: AppEnvironment = {
  production: true,
  name: 'prod',
  backendUrl: 'https://api.volley.example.com',
  oidc: {
    issuer: 'https://zitadel.example.com',
    clientId: 'CHANGE_ME_PROD_CLIENT_ID',
    scope: 'openid profile email offline_access',
    responseType: 'code',
  },
};
