/// <reference lib="webworker" />

import { GeneticAlgoSolver } from '../../../core/services/algos/genetic-algo-solver';

addEventListener('message', ({ data }) => {
  const { players, targetTeamSize, params } = data;
  let solver;
  solver = new GeneticAlgoSolver();
  const teams = solver.generateBalancedTeams(players, targetTeamSize, params );
  postMessage(teams);
});
