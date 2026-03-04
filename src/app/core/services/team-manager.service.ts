import { Injectable, signal } from '@angular/core';
import { Player } from '../models/player';

@Injectable({ providedIn: 'root' })
export class TeamManagerService {
  readonly teams = signal<Player[][]>([]);
  readonly isCalculating = signal<boolean>(false);

  balanceTeams(players: Player[], algo : string, targetTeamSize: number, params : any = {}): void {
    this.isCalculating.set(true);
    const worker = new Worker(new URL('../workers/team-balancer.worker', import.meta.url));

    worker.onmessage = ({ data }) => {
      this.teams.set(data);
      this.isCalculating.set(false);
      worker.terminate();
    };

    worker.postMessage({ players, targetTeamSize, algo, params });
  }
}
