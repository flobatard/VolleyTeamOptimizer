import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { Player } from '../../../core/models/player';
import { PlayerPair } from '../../../core/models/player-pair';
import { ListPairPlayers } from '../../../shared/list-pair-players/list-pair-players';

@Component({
  selector: 'app-genetic-solver-component',
  imports: [FormsModule, ListPairPlayers],
  templateUrl: './genetic-solver-component.html',
  styleUrl: './genetic-solver-component.scss',
})
export class GeneticSolverComponent {
  private readonly playerDataService = inject(PlayerDataService);

  protected readonly players = this.playerDataService.selectedPlayers;
  readonly teams = signal<Player[][]>([]);
  readonly isRunning = signal<boolean>(false);

  protected readonly targetTeamSize = signal(6);
  protected readonly forceEvenTeams = signal(false);

  protected readonly togetherPairsList = signal<PlayerPair[]>([]);
  protected readonly apartPairsList = signal<PlayerPair[]>([]);

  run(): void {
    const selectedPlayers = this.players();
    const teamSize = this.targetTeamSize();
    if (selectedPlayers.length === 0) return;
    this.isRunning.set(true);
    const worker = new Worker(new URL('../workers/genetic-algo.worker', import.meta.url));

    worker.onmessage = ({ data }) => {
      this.teams.set(data);
      this.isRunning.set(false);
      worker.terminate();
    };

    worker.postMessage({
      players: selectedPlayers,
      targetTeamSize: teamSize,
      params: {
        FORCE_EVEN_TEAMS: this.forceEvenTeams(),
        TOGETHER_PAIRS: this.togetherPairsList(),
        APART_PAIRS: this.apartPairsList(),
      },
    });
  }
}
