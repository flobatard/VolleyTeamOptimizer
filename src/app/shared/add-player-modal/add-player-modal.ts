import { Component, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface AddPlayerFormData {
  name: string;
  gender: string;
  global_impact: number;
  attack: number;
  set: number;
  defense: number;
}

@Component({
  selector: 'app-add-player-modal',
  imports: [FormsModule],
  templateUrl: './add-player-modal.html',
  styleUrl: './add-player-modal.scss',
})
export class AddPlayerModal {
  readonly playerAdded = output<AddPlayerFormData>();
  readonly cancelled = output<void>();

  protected form = {
    name: '',
    gender: 'H' as 'H' | 'F' | 'A',
    global_impact: 5,
    attack: 5,
    set: 5,
    defense: 5,
  };

  protected validate(): void {
    const name = this.form.name.trim();
    if (!name) return;

    const data: AddPlayerFormData = {
      name,
      gender: this.form.gender,
      global_impact: this.clamp(this.form.global_impact),
      attack: this.clamp(this.form.attack),
      set: this.clamp(this.form.set),
      defense: this.clamp(this.form.defense),
    };
    this.playerAdded.emit(data);
  }

  private clamp(value: number): number {
    return Math.min(10, Math.max(1, Number(value) || 5));
  }

  protected cancel(): void {
    this.cancelled.emit();
  }
}
