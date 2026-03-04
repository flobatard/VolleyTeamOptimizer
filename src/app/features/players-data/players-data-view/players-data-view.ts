import { Component, computed, inject } from '@angular/core';
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
  protected readonly selectedPlayerIds = this.playerDataService.selectedPlayerIds;

  protected readonly allSelected = computed(
    () => this.players().length > 0 && this.selectedPlayerIds().size === this.players().length,
  );
  protected readonly someSelected = computed(
    () => this.selectedPlayerIds().size > 0 && !this.allSelected(),
  );

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.playerDataService.loadFromCsv(file);
    }
  }

  toggleSelection(id: number): void {
    this.playerDataService.togglePlayerSelection(id);
  }

  toggleAll(): void {
    this.playerDataService.setAllPlayersSelection(!this.allSelected());
  }
}
