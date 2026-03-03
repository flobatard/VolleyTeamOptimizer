import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PlayersDataView } from '../../../features/players-data/players-data-view/players-data-view';

@Component({
  selector: 'app-main-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './main-page.html',
  styleUrl: './main-page.scss',
})
export class MainPage {}
