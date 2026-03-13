import { Component, computed, inject, signal } from '@angular/core';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { AddPlayerModal } from '../../../shared/add-player-modal/add-player-modal';
import { ConfirmModal } from '../../../shared/confirm-modal/confirm-modal';

@Component({
  selector: 'app-players-data-view',
  imports: [AddPlayerModal, ConfirmModal],
  templateUrl: './players-data-view.html',
  styleUrl: './players-data-view.scss',
})
export class PlayersDataView {
  private readonly playerDataService = inject(PlayerDataService);
  protected readonly players = this.playerDataService.players;
  protected readonly selectedPlayerIds = this.playerDataService.selectedPlayerIds;
  protected readonly csvImportResult = this.playerDataService.csvImportResult;

  protected readonly playerToDelete = signal<number | null>(null);
  protected readonly showAddPlayerModal = signal(false);

  protected readonly searchQuery = signal('');
  protected readonly filteredPlayers = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    return q ? this.players().filter(p => p.name.toLowerCase().includes(q)) : this.players();
  });

  protected readonly sortField = signal<'id' | 'name' | 'selected' | 'global_impact'>('global_impact');
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');
  protected readonly sortedFilteredPlayers = computed(() => {
    const players = this.filteredPlayers();
    const field = this.sortField();
    const dir = this.sortDir();
    const selectedIds = this.selectedPlayerIds();
    return [...players].sort((a, b) => {
      let cmp = 0;
      if (field === 'id') cmp = a.id - b.id;
      else if (field === 'name') cmp = a.name.localeCompare(b.name, 'fr');
      else if (field === 'selected') cmp = (selectedIds.has(b.id) ? 1 : 0) - (selectedIds.has(a.id) ? 1 : 0);
      else if (field === 'global_impact') cmp = a.global_impact - b.global_impact;
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  setSort(field: 'id' | 'name' | 'selected' | 'global_impact'): void {
    if (this.sortField() === field) {
      this.sortDir.update(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortDir.set('asc');
    }
  }

  protected sortIcon(field: 'id' | 'name' | 'selected' | 'global_impact'): string {
    if (this.sortField() !== field) return '↕';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }

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

  selectAll(): void {
    this.playerDataService.setAllPlayersSelection(true);
  }

  deselectAll(): void {
    this.playerDataService.setAllPlayersSelection(false);
  }

  exportCsv(): void {
    const content = this.playerDataService.toCsvContent();
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'joueurs.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  openAddPlayerModal(): void {
    this.showAddPlayerModal.set(true);
  }

  onPlayerAdded(data: { name: string; gender: string; global_impact: number; attack: number; set: number; defense: number }): void {
    this.playerDataService.addPlayerWithData(data);
    this.showAddPlayerModal.set(false);
  }

  closeAddPlayerModal(): void {
    this.showAddPlayerModal.set(false);
  }

  confirmDelete(id: number): void {
    this.playerToDelete.set(id);
  }

  cancelDelete(): void {
    this.playerToDelete.set(null);
  }

  deletePlayer(): void {
    const id = this.playerToDelete();
    if (id !== null) {
      this.playerDataService.deletePlayer(id);
      this.playerToDelete.set(null);
    }
  }

  updateName(id: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.playerDataService.updatePlayer(id, { name: value });
  }

  updateGender(id: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.playerDataService.updatePlayer(id, { gender: value });
  }

  updateStat(
    id: number,
    field: 'global_impact' | 'attack' | 'set' | 'defense',
    event: Event,
  ): void {
    const value = Math.min(10, Math.max(1, Number((event.target as HTMLInputElement).value)));
    this.playerDataService.updatePlayer(id, { [field]: value });
  }
}
