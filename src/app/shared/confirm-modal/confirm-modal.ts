import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-confirm-modal',
  imports: [],
  templateUrl: './confirm-modal.html',
  styleUrl: './confirm-modal.scss',
})
export class ConfirmModal {
  readonly message = input.required<string>();
  readonly confirmLabel = input('Confirmer');
  readonly cancelLabel = input('Annuler');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
