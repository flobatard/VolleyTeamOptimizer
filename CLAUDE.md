# VolleyTeamOptimizer — CLAUDE.md

## Project Overview

Angular 21 application that generates balanced volleyball teams using a genetic algorithm. Players are rated on attack, defense, set (passe) and global impact. The algorithm minimizes skill disparity across teams while respecting soft constraints (player pairings, gender balance, positional roles).

## Tech Stack

- **Framework**: Angular 21 (standalone components, signals, SSR)
- **Build**: Vite via `@angular/build`
- **Testing**: Vitest (`ng test`)
- **Language**: TypeScript 5.9, strict mode
- **Styling**: SCSS

## Development Commands

```bash
ng serve        # Dev server at http://localhost:4200
ng build        # Production build → dist/
ng test         # Unit tests (Vitest)
ng build --watch
```

## Project Structure

```
src/app/
├── core/
│   ├── models/               # Player, PlayerPair
│   ├── services/
│   │   ├── player-data.service.ts       # Player CRUD + localStorage
│   │   └── algos/
│   │       └── genetic-algo-solver.ts   # Core genetic algorithm
│   └── components/
│       ├── main-page/        # App shell with nav
│       └── welcome/          # Landing page
├── features/
│   ├── players-data/
│   │   └── players-data-view/   # CSV import, player table + edit
│   └── solvers/
│       ├── genetic-solver-component/    # Algorithm UI + param controls
│       ├── solver-main-page/            # Solver layout
│       └── workers/
│           └── genetic-algo.worker.ts   # Web Worker (non-blocking execution)
└── shared/
    └── list-pair-players/   # Player pair constraint UI
```

## Routing

```
/           → redirect /welcome
/welcome    → Welcome
/main/players-data  → PlayersDataView
/main/solver/genetic → GeneticSolverComponent
```

## Data Models

### Player
```typescript
interface Player {
  id: number;
  name: string;
  attack: number;        // 1–10
  defense: number;       // 1–10
  set: number;           // 1–10 (passe)
  global_impact: number; // 1–10
  gender: string;        // 'H' | 'F'
}
```

### PlayerPair
```typescript
type PairType = 'together' | 'apart';
interface PlayerPair { player1Id: number; player2Id: number; }
```

## CSV Format (import/export)

```
nom;genre;note_globale;attaque;passe;defense
Jean;H;7;8;6;7
Marie;F;8;7;7;9
```

## localStorage Keys

| Key | Content |
|-----|---------|
| `VTO_volleyball_players` | All players (JSON) |
| `VTO_volleyball_selected_ids` | Selected player IDs (JSON) |
| `VTO_genetic_solver_params` | Algorithm parameters (JSON) |
| `VTO_genetic_solver_teams` | Last generated teams (JSON) |
| `VTO_solver_2_solver_params` | Solver 2 algorithm parameters (JSON) |
| `VTO_solver_2_solver_teams` | Solver 2 last generated teams (JSON) |

## Core Algorithm — Genetic Solver

**File**: `src/app/core/services/algos/genetic-algo-solver.ts`

The solver is exposed via a Web Worker to avoid blocking the UI.

### Key Parameters (GAParams)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `POPULATION_SIZE` | 200 | Number of solutions per generation |
| `GENERATIONS` | 1000 | Evolution iterations |
| `MUTATION_RATE` | 0.7 | Probability of swap mutation |
| `FORCE_EVEN_TEAMS` | false | Enforce equal team sizes |
| `ATTACKER_THRESHOLD` | median | Min attack score for "attacker" |
| `ATTACKERS_PER_TEAM` | 1 | Required attackers per team |
| `ATTACK_ABSENCE_PENALTY` | 50 | Penalty if no attacker |
| `SETTER_THRESHOLD` | median | Min set score for "setter" |
| `SETTER_ABSENCE_PENALTY` | 300 | Penalty if no setter |
| `GLOBAL_MEAN_PENALTY_FACTOR` | 1.5 | Weight for global skill balance |
| `TEAM_DEFENSE_PENALTY_FACTOR` | 1 | Weight for defense balance |
| `PAIR_CONSTRAINT_PENALTY` | 1000 | Penalty for violated pair constraint |

### Fitness Function (minimized cost)

Per team:
- `(team_mean_global − target_mean)² × factor`
- `(target_defense − team_defense)² × factor`
- Setter absence + setter deviation penalties
- Attacker absence + count deviation penalties
- `(target_mean_attack − team_attack)² × factor`

Global:
- Gender imbalance: 100 pts/team if female count varies >1
- Pair constraints: 1000 pts per violated "together"/"apart" rule

### Performance Techniques
- Pre-compute constants once before the evolution loop
- Cache fitness scores via `EvaluatedGenome` (avoid redundant evaluations)
- Run entirely in a Web Worker

## Angular Patterns Used

- **Standalone components** (no NgModules)
- **Signals** for reactive state in services and components
- **Dependency Injection** with `inject()`
- **Web Workers** for CPU-intensive tasks
- **SSR** via `@angular/ssr` + Express

## Code Conventions

- All components are standalone
- State is managed via Angular signals
- Persistence goes through `PlayerDataService` (localStorage)
- Algorithm parameters are persisted automatically on signal change
- Strict TypeScript — no `any`, strict templates enabled
