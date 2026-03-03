import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Player } from '../../../core/models/player';
import { GeneticAlgoSolver } from '../../../core/services/algos/genetic-algo-solver';
import { PlayerDataService } from '../../../core/services/player-data.service';

@Component({
  selector: 'app-genetic-solver-component',
  imports: [FormsModule],
  templateUrl: './genetic-solver-component.html',
  styleUrl: './genetic-solver-component.scss',
})
export class GeneticSolverComponent {
  private readonly playerDataService = inject(PlayerDataService);
  protected readonly players = this.playerDataService.players;

  protected readonly targetTeamSize = signal(6);
  protected readonly teams = signal<Player[][]>([]);
  protected readonly isRunning = signal(false);

  run(): void {
    if (this.players().length === 0) return;
    this.isRunning.set(true);
    setTimeout(() => {
      const solver = new GeneticAlgoSolver();
      this.teams.set(solver.generateBalancedTeams(this.players(), this.targetTeamSize()));
      this.isRunning.set(false);
    }, 0);
  }
}
