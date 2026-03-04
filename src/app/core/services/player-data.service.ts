import { computed, Injectable, signal } from '@angular/core';
import { Player } from '../models/player';

const STORAGE_KEY = 'VTO_volleyball_players';
const STORAGE_KEY_SELECTED = 'VTO_volleyball_selected_ids';

@Injectable({
  providedIn: 'root',
})
export class PlayerDataService {
  private readonly _players = signal<Player[]>(this.loadFromStorage());
  readonly players = this._players.asReadonly();

  private readonly _selectedPlayerIds = signal<Set<number>>(this.loadSelectedFromStorage());
  readonly selectedPlayerIds = this._selectedPlayerIds.asReadonly();

  readonly selectedPlayers = computed(() =>
    this._players().filter((p) => this._selectedPlayerIds().has(p.id)),
  );

  private loadFromStorage(): Player[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as Player[];
    } catch {
      return [];
    }
  }

  private loadSelectedFromStorage(): Set<number> {
    const stored = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (!stored) return new Set();
    try {
      return new Set(JSON.parse(stored) as number[]);
    } catch {
      return new Set();
    }
  }

  private persist(players: Player[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  }

  private persistSelected(ids: Set<number>): void {
    localStorage.setItem(STORAGE_KEY_SELECTED, JSON.stringify([...ids]));
  }

  loadFromCsv(file: File): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      const players: Player[] = lines.slice(1).map((line, index) => {
        const [nom, genre, note_globale, attaque, passe, defense] = line.split(';');
        return {
          id: index,
          name: nom.trim(),
          gender: genre.trim(),
          global_impact: Number(note_globale),
          attack: Number(attaque),
          set: Number(passe),
          defense: Number(defense),
        };
      });
      this._players.set(players);
      this.persist(players);
      this._selectedPlayerIds.set(new Set());
      this.persistSelected(new Set());
    };
    reader.readAsText(file, 'UTF-8');
  }

  togglePlayerSelection(id: number): void {
    const current = new Set(this._selectedPlayerIds());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this._selectedPlayerIds.set(current);
    this.persistSelected(current);
  }

  addPlayer(): void {
    const players = this._players();
    const nextId = players.length > 0 ? Math.max(...players.map((p) => p.id)) + 1 : 0;
    const newPlayer: Player = { id: nextId, name: '', gender: 'H', global_impact: 5, attack: 5, set: 5, defense: 5 };
    const updated = [...players, newPlayer];
    this._players.set(updated);
    this.persist(updated);
  }

  deletePlayer(id: number): void {
    const updated = this._players().filter((p) => p.id !== id);
    this._players.set(updated);
    this.persist(updated);
    const selectedIds = new Set(this._selectedPlayerIds());
    if (selectedIds.delete(id)) {
      this._selectedPlayerIds.set(selectedIds);
      this.persistSelected(selectedIds);
    }
  }

  updatePlayer(id: number, changes: Partial<Pick<Player, 'name' | 'global_impact' | 'attack' | 'set' | 'defense' | 'gender'>>): void {
    const updated = this._players().map((p) => (p.id === id ? { ...p, ...changes } : p));
    this._players.set(updated);
    this.persist(updated);
  }

  setAllPlayersSelection(selected: boolean): void {
    const ids = selected ? new Set(this._players().map((p) => p.id)) : new Set<number>();
    this._selectedPlayerIds.set(ids);
    this.persistSelected(ids);
  }

  toCsvContent(): string {
    const header = 'nom;genre;note_globale;attaque;passe;defense';
    const rows = this._players().map(
      (p) => `${p.name};${p.gender};${p.global_impact};${p.attack};${p.set};${p.defense}`,
    );
    return [header, ...rows].join('\n');
  }

  clearPlayers(): void {
    this._players.set([]);
    localStorage.removeItem(STORAGE_KEY);
    this._selectedPlayerIds.set(new Set());
    localStorage.removeItem(STORAGE_KEY_SELECTED);
  }
}
