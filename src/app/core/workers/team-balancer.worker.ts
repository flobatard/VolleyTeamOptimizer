/// <reference lib="webworker" />

addEventListener('message', ({ data }) => {
  const response = `worker response to ${data}`;
  const {players, nb_by_team} = data
  const teams = data.algo(players, nb_by_team)
  postMessage(teams);
});

import { Injectable, signal } from '@angular/core';
import { Player } from '../models/player';

@Injectable({ providedIn: 'root' })
export class TeamManagerService {
  teams = signal<Player[][]>([]);
  isCalculating = signal<boolean>(false);

  balanceTeams(players: Player[]) {
    this.isCalculating.set(true);
    const worker = new Worker(new URL('./team-balancer.worker', import.meta.url));
    
    worker.onmessage = ({ data }) => {
      this.teams.set(data);
      this.isCalculating.set(false);
      worker.terminate(); // On nettoie !
    };
    
    worker.postMessage({ players, numberOfTeams: 2 });
  }
}
