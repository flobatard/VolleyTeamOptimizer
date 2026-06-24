import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-main-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './main-page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './main-page.scss',
})
export class MainPage {
  protected readonly auth = inject(AuthService);
}
