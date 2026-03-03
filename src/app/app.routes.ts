import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full',
  },
  {
    path: 'welcome',
    loadComponent: () =>
      import('./core/components/welcome/welcome').then((m) => m.Welcome),
  },
  {
    path: 'main',
    loadComponent: () =>
      import('./core/components/main-page/main-page').then((m) => m.MainPage),
    children: [
      {
        path: '',
        redirectTo: 'players-data',
        pathMatch: 'full',
      },
      {
        path: 'players-data',
        loadComponent: () =>
          import('./features/players-data/players-data-view/players-data-view').then(
            (m) => m.PlayersDataView
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'welcome',
  },
];
