import { Injectable, signal } from '@angular/core';
import { Player } from '../models/player';

const STORAGE_KEY = 'VTO_volleyball_players';

@Injectable({
  providedIn: 'root',
})
export class PlayerDataService {
  private readonly _players = signal<Player[]>(this.loadFromStorage());
  readonly players = this._players.asReadonly();

  private loadFromStorage(): Player[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as Player[];
    } catch {
      return [];
    }
  }

  private persist(players: Player[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
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
    };
    reader.readAsText(file, 'UTF-8');
  }

  clearPlayers(): void {
    this._players.set([]);
    localStorage.removeItem(STORAGE_KEY);
  }
}
