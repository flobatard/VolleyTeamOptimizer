/// <reference lib="webworker" />

import { VTestAlgoSolver } from '../../../core/services/algos/vtest-algo-solver';

addEventListener('message', ({ data }) => {
  try {
    const { players, targetTeamSize, params } = data;
    const solver = new VTestAlgoSolver();
    const teams = solver.generateTeams(
      players,
      targetTeamSize,
      params,
      (percent) => {
        postMessage({ type: 'progress', percent });
      }
    );
    postMessage({ type: 'success', teams });
  } catch (error) {
    postMessage({
      type: 'error',
      message:
        error instanceof Error ? error.message : 'Erreur inconnue dans le calcul',
    });
  }
});
