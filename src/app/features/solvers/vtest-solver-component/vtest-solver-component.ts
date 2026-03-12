import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { Player } from '../../../core/models/player';
import {
  EstimatedTeam,
  estimateTeamQuality,
} from '../../../core/services/teams-model.service';
import { computeTeamDistributionSummary } from '../../../core/services/team-distribution';

const TEAM_SIZE_OPTIONS = [3, 4, 6] as const;
const STORAGE_KEY = 'VTO_vtest_solver_params';
const STORAGE_KEY_TEAMS = 'VTO_vtest_solver_teams';

interface PersistedParams {
  targetTeamSize: number;
  forceEvenTeams: boolean;
  killerThreshold: number;
  passerThreshold: number;
  maxGlobalDelta: number;
}

const DEFAULT_PARAMS: PersistedParams = {
  targetTeamSize: 4,
  forceEvenTeams: false,
  killerThreshold: 7,
  passerThreshold: 7,
  maxGlobalDelta: 1,
};

function loadParams(): PersistedParams {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = { ...DEFAULT_PARAMS, ...JSON.parse(stored) };
      if (!TEAM_SIZE_OPTIONS.includes(parsed.targetTeamSize as (typeof TEAM_SIZE_OPTIONS)[number])) {
        parsed.targetTeamSize = DEFAULT_PARAMS.targetTeamSize;
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
  selector: 'app-vtest-solver-component',
  imports: [FormsModule],
  templateUrl: './vtest-solver-component.html',
  styleUrl: './vtest-solver-component.scss',
})
export class VtestSolverComponent {
  private readonly playerDataService = inject(PlayerDataService);

  protected readonly players = this.playerDataService.selectedPlayers;
  readonly teams = signal<EstimatedTeam[]>(loadTeams());
  readonly isRunning = signal<boolean>(false);
  readonly workerError = signal<string | null>(null);
  readonly progress = signal<number>(0);

  private readonly p = loadParams();

  protected readonly targetTeamSize = signal(this.p.targetTeamSize);
  protected readonly forceEvenTeams = signal(this.p.forceEvenTeams);
  protected readonly teamSizeOptions = TEAM_SIZE_OPTIONS;

  readonly teamDistributionSummary = computed(() => {
    const n = this.players().length;
    const size = this.targetTeamSize();
    const forceEven = this.forceEvenTeams();
    if (n === 0) return null;
    return computeTeamDistributionSummary(n, size, forceEven);
  });
  protected readonly killerThreshold = signal(this.p.killerThreshold);
  protected readonly passerThreshold = signal(this.p.passerThreshold);
  protected readonly maxGlobalDelta = signal(this.p.maxGlobalDelta);

  constructor() {
    effect(() => {
      const params: PersistedParams = {
        targetTeamSize: this.targetTeamSize(),
        forceEvenTeams: this.forceEvenTeams(),
        killerThreshold: this.killerThreshold(),
        passerThreshold: this.passerThreshold(),
        maxGlobalDelta: this.maxGlobalDelta(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    });

    effect(() => {
      localStorage.setItem(STORAGE_KEY_TEAMS, JSON.stringify(this.teams()));
    });
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
      new URL('../workers/vtest-algo.worker', import.meta.url)
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
        KILLER_THRESHOLD: this.killerThreshold(),
        PASSER_THRESHOLD: this.passerThreshold(),
        FORCE_EVEN_TEAMS: this.forceEvenTeams(),
        MAX_GLOBAL_DELTA: this.maxGlobalDelta(),
      },
    });
  }
}
