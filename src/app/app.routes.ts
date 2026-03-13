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
      {
        path: 'solver',
        loadComponent: () =>
          import('./features/solvers/solver-main-page/solver-main-page').then(
            (m) => m.SolverMainPage
          ),
        children: [
          {
            path: '',
            redirectTo: 'genetic',
            pathMatch: 'full',
          },
          {
            path: 'genetic',
            loadComponent: () =>
              import('./features/solvers/genetic-solver-component/genetic-solver-component').then(
                (m) => m.GeneticSolverComponent
              ),
          },
          {
            path: 'solver-2',
            loadComponent: () =>
              import('./features/solvers/solver-2-solver-component/solver-2-solver-component').then(
                (m) => m.Solver2SolverComponent
              ),
          },
        ],
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'welcome',
  },
];
