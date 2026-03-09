/// <reference lib="webworker" />

import { GeneticAlgoSolver } from '../../../core/services/algos/genetic-algo-solver';

addEventListener('message', ({ data }) => {
  try {
    const { players, targetTeamSize, params } = data;
    const solver = new GeneticAlgoSolver();
    const teams = solver.generateBalancedTeams(players, targetTeamSize, params, (percent) => {
      postMessage({ type: 'progress', percent });
    });
    postMessage({ type: 'success', teams });
  } catch (error) {
    postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Erreur inconnue dans le calcul' });
  }
});
