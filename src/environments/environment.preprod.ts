import { AppEnvironment } from './app-environment';

/**
 * Environnement PREPROD (build via `ng build --configuration=preprod`).
 * ⚠️ Valeurs à renseigner avec votre instance ZITADEL et votre backend de preprod.
 */
export const environment: AppEnvironment = {
  production: true,
  name: 'preprod',
  backendUrl: 'https://api.preprod.volley.example.com',
  oidc: {
    issuer: 'https://zitadel.preprod.example.com',
    clientId: 'CHANGE_ME_PREPROD_CLIENT_ID',
    scope: 'openid profile email offline_access',
    responseType: 'code',
  },
};
