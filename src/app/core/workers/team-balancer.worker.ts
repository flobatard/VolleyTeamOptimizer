/// <reference lib="webworker" />

import { GeneticAlgoSolver } from '../services/algos/genetic-algo-solver';

addEventListener('message', ({ data }) => {
  const { players, targetTeamSize, algo } = data;
  let solver;
  switch (algo)
  {
    case 'genetic':
      solver = new GeneticAlgoSolver();
      break;
    default:
      throw `Error ${algo} is not a known algorithm`
  }
  const teams = solver.generateBalancedTeams(players, targetTeamSize );
  postMessage(teams);
});
