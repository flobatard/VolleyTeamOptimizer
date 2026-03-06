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

  // Paramètres algo
  protected readonly populationSize = signal(200);
  protected readonly generations = signal(1000);
  protected readonly mutationRate = signal(0.7);

  // Paramètres attaque
  protected readonly attackerThreshold = signal<number | null>(null);
  protected readonly attackersPerTeam = signal(1);
  protected readonly attackAbsencePenalty = signal(50);

  // Paramètres passe
  protected readonly setterThreshold = signal<number | null>(null);
  protected readonly setterAbsencePenalty = signal(300);

  // Paramètres généraux
  protected readonly globalMeanPenaltyFactor = signal(1);
  protected readonly teamDefensePenaltyFactor = signal(1);

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
        POPULATION_SIZE: this.populationSize(),
        GENERATIONS: this.generations(),
        MUTATION_RATE: this.mutationRate(),
        ATTACKER_THRESHOLD: this.attackerThreshold() ?? undefined,
        ATTACKERS_PER_TEAM: this.attackersPerTeam(),
        ATTACK_ABSENCE_PENALTY: this.attackAbsencePenalty(),
        SETTER_THRESHOLD: this.setterThreshold() ?? undefined,
        SETTER_ABSENCE_PENALTY: this.setterAbsencePenalty(),
        GLOBAL_MEAN_PENALTY_FACTOR: this.globalMeanPenaltyFactor(),
        TEAM_DEFENSE_PENALTY_FACTOR: this.teamDefensePenaltyFactor(),
        TOGETHER_PAIRS: this.togetherPairsList(),
        APART_PAIRS: this.apartPairsList(),
      },
    });
  }
}
