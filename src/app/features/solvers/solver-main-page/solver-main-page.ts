import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-solver-main-page',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './solver-main-page.html',
  styleUrl: './solver-main-page.scss',
})
export class SolverMainPage {}
