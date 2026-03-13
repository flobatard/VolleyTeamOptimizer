/// <reference lib="webworker" />

import { Solver2AlgoSolver } from '../../../core/services/algos/solver-2-algo-solver';

addEventListener('message', ({ data }) => {
  try {
    const { players, targetTeamSize, params } = data;
    const solver = new Solver2AlgoSolver();
    const { teams, attemptCount, valid } = solver.generateTeams(
      players,
      targetTeamSize,
      params,
      (percent) => {
        postMessage({ type: 'progress', percent });
      }
    );
    postMessage({ type: 'success', teams, attemptCount, valid: valid ?? true });
  } catch (error) {
    postMessage({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Erreur inconnue dans le calcul',
    });
  }
});
