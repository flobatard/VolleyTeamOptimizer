# VolleyTeamOptimizer

Générateur intelligent d'équipes de volley basé sur un algorithme génétique, développé en Angular 21.

## Fonctionnalités

- **Import CSV** : chargez vos joueurs via un fichier CSV semicolon-separated
- **Multi-critères** : prise en compte de l'attaque, la passe, la défense et la note globale
- **Algorithme génétique** : optimisation évolutionnaire sur 1000 générations pour minimiser les écarts de niveau
- **Contraintes souples** : forcez des joueurs à être ensemble ou séparés, équilibrez le genre
- **Non-bloquant** : l'algorithme tourne dans un Web Worker pour ne pas figer l'interface
- **Persistance** : joueurs, sélection, paramètres et équipes générées sont sauvegardés en localStorage

## Format CSV

```
nom;genre;note_globale;attaque;passe;defense
Jean;H;7;8;6;7
Marie;F;8;7;7;9
```

## Stack Technique

| Couche | Techno |
|--------|--------|
| Framework | Angular 21 (standalone, signals, SSR) |
| Build | Vite via `@angular/build` |
| Tests | Vitest |
| Langage | TypeScript 5.9 strict |
| Style | SCSS |

## Architecture

```
src/app/
├── core/
│   ├── models/           # Player, PlayerPair
│   ├── services/
│   │   ├── player-data.service.ts
│   │   └── algos/genetic-algo-solver.ts   ← cœur métier
│   └── components/       # MainPage, Welcome
├── features/
│   ├── players-data/     # Import CSV, tableau joueurs
│   └── solvers/
│       ├── genetic-solver-component/      # UI paramètres + lancement
│       └── workers/genetic-algo.worker.ts ← exécution en arrière-plan
└── shared/
    └── list-pair-players/ # Contraintes de paires
```

## Développement

```bash
# Serveur de développement
ng serve

# Build production
ng build

# Tests unitaires
ng test
```

## Docker

```bash
docker compose up
```

## Paramètres de l'algorithme génétique

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `POPULATION_SIZE` | 200 | Solutions par génération |
| `GENERATIONS` | 1000 | Nombre d'itérations |
| `MUTATION_RATE` | 0.7 | Probabilité de mutation (swap) |
| `FORCE_EVEN_TEAMS` | false | Forcer des équipes de taille égale |
| `ATTACKERS_PER_TEAM` | 1 | Attaquants requis par équipe |
| `ATTACK_ABSENCE_PENALTY` | 50 | Pénalité si aucun attaquant |
| `SETTER_ABSENCE_PENALTY` | 300 | Pénalité si aucun passeur |
| `GLOBAL_MEAN_PENALTY_FACTOR` | 1.5 | Poids de l'équilibre global |
| `PAIR_CONSTRAINT_PENALTY` | 1000 | Pénalité par contrainte de paire violée |
