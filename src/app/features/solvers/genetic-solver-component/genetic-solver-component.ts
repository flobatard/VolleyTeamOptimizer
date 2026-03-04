import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { TeamManagerService } from '../../../core/services/team-manager.service';

@Component({
  selector: 'app-genetic-solver-component',
  imports: [FormsModule],
  templateUrl: './genetic-solver-component.html',
  styleUrl: './genetic-solver-component.scss',
})
export class GeneticSolverComponent {
  private readonly playerDataService = inject(PlayerDataService);
  private readonly teamManagerService = inject(TeamManagerService);

  protected readonly players = this.playerDataService.players;
  protected readonly teams = this.teamManagerService.teams;
  protected readonly isRunning = this.teamManagerService.isCalculating;

  protected readonly targetTeamSize = signal(6);

  run(): void {
    if (this.players().length === 0) return;
    this.teamManagerService.balanceTeams(this.players(), 'genetic', this.targetTeamSize());
  }
}
