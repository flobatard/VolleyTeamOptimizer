import { AppEnvironment } from './app-environment';

/**
 * Environnement par défaut = DEV (utilisé par `ng serve` et `ng build --configuration=development`).
 * Les configurations `preprod`/`production` remplacent ce fichier via `fileReplacements` (angular.json).
 *
 * ⚠️ Valeurs à renseigner avec votre instance ZITADEL et votre backend de dev.
 */
export const environment: AppEnvironment = {
  production: false,
  name: 'dev',
  backendUrl: 'http://localhost:3000',
  oidc: {
    issuer: 'https://zitadel.dev.example.com',
    clientId: 'CHANGE_ME_DEV_CLIENT_ID',
    scope: 'openid profile email offline_access',
    responseType: 'code',
  },
};
