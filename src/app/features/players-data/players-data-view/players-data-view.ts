import { Component, inject } from '@angular/core';
import { PlayerDataService } from '../../../core/services/player-data.service';

@Component({
  selector: 'app-players-data-view',
  imports: [],
  templateUrl: './players-data-view.html',
  styleUrl: './players-data-view.scss',
})
export class PlayersDataView {
  private readonly playerDataService = inject(PlayerDataService);
  protected readonly players = this.playerDataService.players;

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.playerDataService.loadFromCsv(file);
    }
  }
}
