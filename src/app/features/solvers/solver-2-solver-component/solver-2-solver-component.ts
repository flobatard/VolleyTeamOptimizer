import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { Player } from '../../../core/models/player';
import {
  EstimatedTeam,
  estimateTeamQuality,
} from '../../../core/services/teams-model.service';
import { computeTeamDistributionSummary } from '../../../core/services/team-distribution';
import { PlayerPair } from '../../../core/models/player-pair';
import { PlayerTeamSizeConstraint } from '../../../core/models/player-team-size-constraint';
import { ListPairPlayers } from '../../../shared/list-pair-players/list-pair-players';

const TEAM_SIZE_OPTIONS = [3, 4, 5, 6] as const;
const STORAGE_KEY = 'VTO_solver_2_solver_params';
const STORAGE_KEY_TEAMS = 'VTO_solver_2_solver_teams';

interface PersistedParams {
  targetTeamSize: number;
  forceEvenTeams: boolean;
  numTeams?: number;
  killerThreshold: number;
  passerThreshold: number;
  maxGlobalDelta: number;
  togetherPairsList: PlayerPair[];
  apartPairsList: PlayerPair[];
  playerTeamSizeConstraints: PlayerTeamSizeConstraint[];
}

const DEFAULT_PARAMS: PersistedParams = {
  targetTeamSize: 4,
  forceEvenTeams: false,
  killerThreshold: 7,
  passerThreshold: 7,
  maxGlobalDelta: 1,
  togetherPairsList: [],
  apartPairsList: [],
  playerTeamSizeConstraints: [],
};

function loadParams(): PersistedParams {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = { ...DEFAULT_PARAMS, ...JSON.parse(stored) };
      if (!TEAM_SIZE_OPTIONS.includes(parsed.targetTeamSize as (typeof TEAM_SIZE_OPTIONS)[number])) {
        parsed.targetTeamSize = DEFAULT_PARAMS.targetTeamSize;
      }
      if (!Array.isArray(parsed.togetherPairsList)) parsed.togetherPairsList = DEFAULT_PARAMS.togetherPairsList;
      if (!Array.isArray(parsed.apartPairsList)) parsed.apartPairsList = DEFAULT_PARAMS.apartPairsList;
      if (!Array.isArray(parsed.playerTeamSizeConstraints)) {
        parsed.playerTeamSizeConstraints = DEFAULT_PARAMS.playerTeamSizeConstraints;
      }
      return parsed;
    }
  } catch {}
  return DEFAULT_PARAMS;
}

function loadTeams(): EstimatedTeam[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TEAMS);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

@Component({
  selector: 'app-solver-2-solver-component',
  imports: [FormsModule, ListPairPlayers],
  templateUrl: './solver-2-solver-component.html',
  styleUrl: './solver-2-solver-component.scss',
})
export class Solver2SolverComponent {
  protected readonly playerDataService = inject(PlayerDataService);

  protected readonly players = this.playerDataService.selectedPlayers;
  readonly teams = signal<EstimatedTeam[]>(loadTeams());
  readonly isRunning = signal<boolean>(false);
  readonly workerError = signal<string | null>(null);
  readonly progress = signal<number>(0);

  private readonly p = loadParams();

  protected readonly targetTeamSize = signal(this.p.targetTeamSize);
  protected readonly forceEvenTeams = signal(this.p.forceEvenTeams);
  protected readonly teamSizeOptions = TEAM_SIZE_OPTIONS;

  private numTeamsInitialized = this.p.numTeams != null;
  protected readonly numTeams = signal(this.p.numTeams ?? 2);

  readonly numTeamsRange = computed(() => {
    const n = this.players().length;
    const forceEven = this.forceEvenTeams();
    const min = 2;
    let max = n > 0 ? Math.max(2, Math.floor(n / 2)) : 2;
    if (forceEven && max % 2 !== 0) {
      max = Math.max(2, max - 1);
    }
    const step = forceEven ? 2 : 1;
    return { min, max, step };
  });

  readonly teamDistributionSummary = computed(() => {
    const n = this.players().length;
    const size = this.targetTeamSize();
    const forceEven = this.forceEvenTeams();
    const override = this.numTeams();
    if (n === 0) return null;
    return computeTeamDistributionSummary(n, size, forceEven, override);
  });
  protected readonly killerThreshold = signal(this.p.killerThreshold);
  protected readonly passerThreshold = signal(this.p.passerThreshold);
  protected readonly maxGlobalDelta = signal(this.p.maxGlobalDelta);

  protected readonly togetherPairsList = signal<PlayerPair[]>(this.p.togetherPairsList);
  protected readonly apartPairsList = signal<PlayerPair[]>(this.p.apartPairsList);
  protected readonly playerTeamSizeConstraints = signal<PlayerTeamSizeConstraint[]>(
    this.p.playerTeamSizeConstraints
  );

  protected readonly teamSizeOptionsForConstraints = TEAM_SIZE_OPTIONS;

  constructor() {
    effect(() => {
      if (!this.numTeamsInitialized) {
        const n = this.players().length;
        if (n > 0) {
          const summary = computeTeamDistributionSummary(
            n,
            this.targetTeamSize(),
            this.forceEvenTeams()
          );
          this.numTeams.set(summary.numTeams);
          this.numTeamsInitialized = true;
        }
      }
    });

    effect(() => {
      const n = this.players().length;
      const size = this.targetTeamSize();
      const forceEven = this.forceEvenTeams();
      if (n > 0) {
        const summary = computeTeamDistributionSummary(n, size, forceEven);
        this.numTeams.set(summary.numTeams);
      }
    });

    effect(() => {
      const range = this.numTeamsRange();
      const forceEven = this.forceEvenTeams();
      let current = this.numTeams();
      if (current < range.min || current > range.max) {
        current = Math.max(range.min, Math.min(range.max, current));
        this.numTeams.set(current);
      }
      if (forceEven && current % 2 !== 0) {
        const nearestEven = Math.max(range.min, Math.min(range.max, Math.round(current / 2) * 2));
        this.numTeams.set(nearestEven);
      }
    });

    effect(() => {
      const selectedIds = new Set(this.players().map((p) => p.id));
      const filterPair = (p: PlayerPair) =>
        selectedIds.has(p.player1Id) && selectedIds.has(p.player2Id);
      const together = this.togetherPairsList().filter(filterPair);
      const apart = this.apartPairsList().filter(filterPair);
      const teamSize = this.playerTeamSizeConstraints().filter((c) => selectedIds.has(c.playerId));
      const needsUpdate =
        together.length !== this.togetherPairsList().length ||
        apart.length !== this.apartPairsList().length ||
        teamSize.length !== this.playerTeamSizeConstraints().length;
      if (needsUpdate) {
        this.togetherPairsList.set(together);
        this.apartPairsList.set(apart);
        this.playerTeamSizeConstraints.set(teamSize);
      }
    });

    effect(() => {
      const params: PersistedParams = {
        targetTeamSize: this.targetTeamSize(),
        forceEvenTeams: this.forceEvenTeams(),
        numTeams: this.numTeams(),
        killerThreshold: this.killerThreshold(),
        passerThreshold: this.passerThreshold(),
        maxGlobalDelta: this.maxGlobalDelta(),
        togetherPairsList: this.togetherPairsList(),
        apartPairsList: this.apartPairsList(),
        playerTeamSizeConstraints: this.playerTeamSizeConstraints(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    });

    effect(() => {
      localStorage.setItem(STORAGE_KEY_TEAMS, JSON.stringify(this.teams()));
    });
  }

  protected playerName(id: number): string {
    return this.playerDataService.players().find((p) => p.id === id)?.name ?? '?';
  }

  protected addTeamSizeConstraint(): void {
    const playerId = this.newConstraintPlayerId();
    const excludedSizes = this.newConstraintExcludedSizes();
    if (playerId === null || excludedSizes.length === 0) return;
    const existing = this.playerTeamSizeConstraints().find((c) => c.playerId === playerId);
    if (existing) return;
    this.playerTeamSizeConstraints.update((list) => [
      ...list,
      { playerId, excludedSizes: [...excludedSizes] },
    ]);
    this.newConstraintPlayerId.set(null);
    this.newConstraintExcludedSizes.set([]);
    this.newConstraintSearchName.set('');
  }

  protected removeTeamSizeConstraint(index: number): void {
    this.playerTeamSizeConstraints.update((list) => list.filter((_, i) => i !== index));
  }

  protected newConstraintPlayerId = signal<number | null>(null);
  protected newConstraintExcludedSizes = signal<number[]>([]);
  protected newConstraintSearchName = signal('');

  protected onConstraintPlayerChange(name: string): void {
    this.newConstraintSearchName.set(name);
    const player = this.players().find((p) => p.name === name);
    this.newConstraintPlayerId.set(player?.id ?? null);
  }

  protected toggleExcludedSize(size: number): void {
    this.newConstraintExcludedSizes.update((sizes) => {
      const has = sizes.includes(size);
      return has ? sizes.filter((s) => s !== size) : [...sizes, size].sort((a, b) => a - b);
    });
  }

  protected isSizeExcluded(size: number): boolean {
    return this.newConstraintExcludedSizes().includes(size);
  }

  protected formatExcludedSizes(constraint: PlayerTeamSizeConstraint): string {
    return constraint.excludedSizes.join(', ');
  }

  copyTeams(): void {
    const text = this.teams()
      .map((t, i) =>
        `Équipe ${i + 1}:\n${t.team.map((p) => p.name).join('\n')}`
      )
      .join('\n\n');
    navigator.clipboard.writeText(text);
  }

  run(): void {
    const selectedPlayers = this.players();
    const teamSize = this.targetTeamSize();
    if (selectedPlayers.length === 0) return;

    this.isRunning.set(true);
    this.workerError.set(null);
    this.progress.set(0);

    const worker = new Worker(
      new URL('../workers/solver-2-algo.worker', import.meta.url)
    );

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        this.progress.set(data.percent);
      } else if (data.type === 'error') {
        this.workerError.set(data.message);
        this.isRunning.set(false);
        worker.terminate();
      } else {
        this.progress.set(100);
        const killerTh = this.killerThreshold();
        const passerTh = this.passerThreshold();
        const estimatedTeams = data.teams.map((t: Player[]) =>
          estimateTeamQuality(t, 1, killerTh, passerTh)
        );
        this.teams.set(estimatedTeams);
        this.isRunning.set(false);
        worker.terminate();
      }
    };

    worker.onerror = (error) => {
      this.workerError.set(
        error.message ?? 'Erreur inattendue dans le calcul'
      );
      this.isRunning.set(false);
      worker.terminate();
    };

    worker.postMessage({
      players: selectedPlayers,
      targetTeamSize: teamSize,
      params: {
        NUM_TEAMS: this.numTeams(),
        KILLER_THRESHOLD: this.killerThreshold(),
        PASSER_THRESHOLD: this.passerThreshold(),
        FORCE_EVEN_TEAMS: this.forceEvenTeams(),
        MAX_GLOBAL_DELTA: this.maxGlobalDelta(),
        TOGETHER_PAIRS: this.togetherPairsList(),
        APART_PAIRS: this.apartPairsList(),
        PLAYER_TEAM_SIZE_CONSTRAINTS: this.playerTeamSizeConstraints(),
      },
    });
  }
}
