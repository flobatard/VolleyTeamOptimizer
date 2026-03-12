import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../core/services/player-data.service';
import { Player } from '../../core/models/player';
import { PlayerPair } from '../../core/models/player-pair';

@Component({
  selector: 'app-list-pair-players',
  imports: [FormsModule],
  templateUrl: './list-pair-players.html',
  styleUrl: './list-pair-players.scss',
})
export class ListPairPlayers {
  private static instanceCount = 0;
  protected readonly instanceId = ++ListPairPlayers.instanceCount;

  private readonly playerDataService = inject(PlayerDataService);

  /** Joueurs disponibles pour la sélection. Si non fourni, utilise tous les joueurs. */
  readonly availablePlayers = input<Player[] | null>(null);

  /** Liste des joueurs affichés dans le datalist (sélectionnés ou tous) */
  protected readonly players = computed(() => this.availablePlayers() ?? this.playerDataService.players());

  /** Paires initiales (ex. depuis localStorage). Le parent est la source de vérité. */
  readonly initialPairs = input<PlayerPair[]>([]);

  private readonly _pairs = signal<PlayerPair[]>([]);
  readonly pairs = this._pairs.asReadonly();
  readonly pairsChange = output<PlayerPair[]>();

  constructor() {
    effect(() => {
      const init = this.initialPairs();
      this._pairs.set(init);
    });
  }

  protected newId1: number | null = null;
  protected newId2: number | null = null;
  protected searchName1 = '';
  protected searchName2 = '';

  protected onName1Change(name: string): void {
    const player = this.players().find((p) => p.name === name);
    this.newId1 = player?.id ?? null;
  }

  protected onName2Change(name: string): void {
    const player = this.players().find((p) => p.name === name);
    this.newId2 = player?.id ?? null;
  }

  protected playerName(id: number): string {
    return this.playerDataService.players().find((p) => p.id === id)?.name ?? '?';
  }

  addPair(): void {
    const id1 = this.newId1;
    const id2 = this.newId2;
    if (id1 === null || id2 === null || id1 === id2) return;
    const alreadyExists = this._pairs().some(
      (p) =>
        (p.player1Id === id1 && p.player2Id === id2) ||
        (p.player1Id === id2 && p.player2Id === id1),
    );
    if (alreadyExists) return;
    this._pairs.update((pairs) => [...pairs, { player1Id: id1, player2Id: id2 }]);
    this.pairsChange.emit(this._pairs());
    this.newId1 = null;
    this.newId2 = null;
    this.searchName1 = '';
    this.searchName2 = '';
  }

  removePair(index: number): void {
    this._pairs.update((pairs) => pairs.filter((_, i) => i !== index));
    this.pairsChange.emit(this._pairs());
  }
}
