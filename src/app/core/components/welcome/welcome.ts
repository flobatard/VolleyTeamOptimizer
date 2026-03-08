import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';

@Component({
  selector: 'app-welcome',
  imports: [RouterLink],
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
})
export class Welcome implements OnInit {
  constructor(private titleService: Title, private metaService: Meta) {}

  ngOnInit(): void {
    this.titleService.setTitle('Volley Team Optimizer — Équilibrez vos équipes de volley');
    this.metaService.addTags([
      {
        name: 'description',
        content:
          'Créez des équipes de volley équilibrées en quelques clics grâce à un algorithme génétique. Import CSV, contraintes de paires, optimisation automatique.',
      },
      { property: 'og:title', content: 'Volley Team Optimizer' },
      {
        property: 'og:description',
        content: 'Équilibrez vos équipes de volley avec un algorithme génétique.',
      },
      { property: 'og:type', content: 'website' },
    ]);
  }
}
