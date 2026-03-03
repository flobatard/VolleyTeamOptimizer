import { Injectable, signal } from '@angular/core';
import { Player } from '../models/player';

@Injectable({
  providedIn: 'root',
})
export class PlayerDataService {
  private readonly _players = signal<Player[]>([]);
  readonly players = this._players.asReadonly();

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
    };
    reader.readAsText(file, 'UTF-8');
  }
}
