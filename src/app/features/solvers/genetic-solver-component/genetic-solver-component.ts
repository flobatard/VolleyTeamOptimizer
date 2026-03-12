import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { Player } from '../../../core/models/player';
import { PlayerPair } from '../../../core/models/player-pair';
import { ListPairPlayers } from '../../../shared/list-pair-players/list-pair-players';
import { EstimatedTeam, estimateTeamQuality } from '../../../core/services/teams-model.service';
import { calculatePlayerMedian } from '../../../core/services/algos/genetic-algo-solver';
import { computeTeamDistributionSummary } from '../../../core/services/team-distribution';

const TEAM_SIZE_OPTIONS = [3, 4, 5, 6] as const;

const STORAGE_KEY = 'VTO_genetic_solver_params';
const STORAGE_KEY_TEAMS = 'VTO_genetic_solver_teams';

interface PersistedParams {
  targetTeamSize: number;
  forceEvenTeams: boolean;
  numTeams?: number;
  populationSize: number;
  generations: number;
  mutationRate: number;
  attackerThreshold: number | null;
  attackersPerTeam: number;
  attackAbsencePenalty: number;
  setterThreshold: number | null;
  setterAbsencePenalty: number;
  globalMeanPenaltyFactor: number;
  teamDefensePenaltyFactor: number;
  togetherPairsList: PlayerPair[];
  apartPairsList: PlayerPair[];
}

const DEFAULT_PARAMS: PersistedParams = {
  targetTeamSize: 4,
  forceEvenTeams: false,
  populationSize: 200,
  generations: 1000,
  mutationRate: 0.7,
  attackerThreshold: null,
  attackersPerTeam: 1,
  attackAbsencePenalty: 50,
  setterThreshold: null,
  setterAbsencePenalty: 300,
  globalMeanPenaltyFactor: 1.5,
  teamDefensePenaltyFactor: 1,
  togetherPairsList: [],
  apartPairsList: [],
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
  selector: 'app-genetic-solver-component',
  imports: [FormsModule, ListPairPlayers],
  templateUrl: './genetic-solver-component.html',
  styleUrl: './genetic-solver-component.scss',
})
export class GeneticSolverComponent {
  private readonly playerDataService = inject(PlayerDataService);

  protected readonly players = this.playerDataService.selectedPlayers;
  readonly teams = signal<EstimatedTeam[]>(loadTeams());
  readonly isRunning = signal<boolean>(false);
  readonly workerError = signal<string | null>(null);
  readonly progress = signal<number>(0);
  readonly convergence = signal<{ generation: number, bestCost: number }[]>([]);

  readonly convergenceSvgData = computed(() => {
    const data = this.convergence();
    if (data.length < 2) return null;
    const maxGen = data[data.length - 1].generation;
    const maxCost = Math.max(...data.map(d => d.bestCost));
    const minCost = Math.min(...data.map(d => d.bestCost));
    const range = maxCost - minCost;
    const toX = (gen: number) => 60 + (gen / maxGen) * 550;
    const toY = (cost: number) => range === 0 ? 90 : 170 - ((cost - minCost) / range) * 160;
    const path = data.map((d, i) =>
      `${i === 0 ? 'M' : 'L'}${toX(d.generation).toFixed(1)},${toY(d.bestCost).toFixed(1)}`
    ).join(' ');
    return {
      path,
      maxCost: Math.round(maxCost),
      minCost: Math.round(minCost),
      finalCost: Math.round(data[data.length - 1].bestCost),
    };
  });

  private readonly p = loadParams();

  protected readonly targetTeamSize = signal(this.p.targetTeamSize);
  protected readonly forceEvenTeams = signal(this.p.forceEvenTeams);
  protected readonly teamSizeOptions = TEAM_SIZE_OPTIONS;

  private numTeamsInitialized = this.p.numTeams != null;
  protected readonly numTeams = signal(
    this.p.numTeams ?? 2
  );

  readonly numTeamsRange = computed(() => {
    const n = this.players().length;
    const min = 2;
    const max = n > 0 ? Math.max(2, Math.floor(n / 2)) : 2;
    return { min, max };
  });

  readonly teamDistributionSummary = computed(() => {
    const n = this.players().length;
    const size = this.targetTeamSize();
    const forceEven = this.forceEvenTeams();
    const override = this.numTeams();
    if (n === 0) return null;
    return computeTeamDistributionSummary(n, size, forceEven, override);
  });

  // Paramètres algo
  protected readonly populationSize = signal(this.p.populationSize);
  protected readonly generations = signal(this.p.generations);
  protected readonly mutationRate = signal(this.p.mutationRate);

  // Paramètres attaque
  protected readonly attackerThreshold = signal<number | null>(this.p.attackerThreshold);
  protected readonly attackersPerTeam = signal(this.p.attackersPerTeam);
  protected readonly attackAbsencePenalty = signal(this.p.attackAbsencePenalty);

  // Paramètres passe
  protected readonly setterThreshold = signal<number | null>(this.p.setterThreshold);
  protected readonly setterAbsencePenalty = signal(this.p.setterAbsencePenalty);

  // Paramètres généraux
  protected readonly globalMeanPenaltyFactor = signal(this.p.globalMeanPenaltyFactor);
  protected readonly teamDefensePenaltyFactor = signal(this.p.teamDefensePenaltyFactor);

  protected readonly togetherPairsList = signal<PlayerPair[]>(this.p.togetherPairsList);
  protected readonly apartPairsList = signal<PlayerPair[]>(this.p.apartPairsList);

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
      const current = this.numTeams();
      if (current < range.min || current > range.max) {
        this.numTeams.set(Math.max(range.min, Math.min(range.max, current)));
      }
    });

    effect(() => {
      const selectedIds = new Set(this.players().map((p) => p.id));
      const filterPair = (p: PlayerPair) =>
        selectedIds.has(p.player1Id) && selectedIds.has(p.player2Id);
      const together = this.togetherPairsList().filter(filterPair);
      const apart = this.apartPairsList().filter(filterPair);
      if (together.length !== this.togetherPairsList().length || apart.length !== this.apartPairsList().length) {
        this.togetherPairsList.set(together);
        this.apartPairsList.set(apart);
      }
    });

    effect(() => {
      const params: PersistedParams = {
        targetTeamSize: this.targetTeamSize(),
        forceEvenTeams: this.forceEvenTeams(),
        numTeams: this.numTeams(),
        populationSize: this.populationSize(),
        generations: this.generations(),
        mutationRate: this.mutationRate(),
        attackerThreshold: this.attackerThreshold(),
        attackersPerTeam: this.attackersPerTeam(),
        attackAbsencePenalty: this.attackAbsencePenalty(),
        setterThreshold: this.setterThreshold(),
        setterAbsencePenalty: this.setterAbsencePenalty(),
        globalMeanPenaltyFactor: this.globalMeanPenaltyFactor(),
        teamDefensePenaltyFactor: this.teamDefensePenaltyFactor(),
        togetherPairsList: this.togetherPairsList(),
        apartPairsList: this.apartPairsList(),
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
        `Équipe ${i + 1}:\n${t.team.map(p => p.name).join('\n')}`
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
    this.convergence.set([]);
    const worker = new Worker(new URL('../workers/genetic-algo.worker', import.meta.url));

    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        this.progress.set(data.percent);
      } else if (data.type === 'error') {
        this.workerError.set(data.message);
        this.isRunning.set(false);
        worker.terminate();
      } else {
        this.progress.set(100);
        const attackerThreshold = this.attackerThreshold() ?? calculatePlayerMedian(this.players(), p => p.attack)
        const setterThreshold = this.setterThreshold() ?? calculatePlayerMedian(this.players(), p => p.set) + 0.5
        
        const estimatedTeams = data.teams.map((t : Player[]) => estimateTeamQuality(t, this.attackersPerTeam() ?? 1, attackerThreshold, setterThreshold ))
        this.teams.set(estimatedTeams);
        this.convergence.set(data.convergence ?? []);
        this.isRunning.set(false);
        worker.terminate();
      }
    };

    worker.onerror = (error) => {
      this.workerError.set(error.message ?? 'Erreur inattendue dans le calcul');
      this.isRunning.set(false);
      worker.terminate();
    };

    worker.postMessage({
      players: selectedPlayers,
      targetTeamSize: teamSize,
      params: {
        NUM_TEAMS: this.numTeams(),
        FORCE_EVEN_TEAMS: this.forceEvenTeams(),
        POPULATION_SIZE: this.populationSize(),
        GENERATIONS: this.generations(),
        MUTATION_RATE: this.mutationRate(),
        ATTACKER_THRESHOLD: this.attackerThreshold() ?? undefined,
        ATTACKERS_PER_TEAM: this.attackersPerTeam(),
        ATTACK_ABSENCE_PENALTY: this.attackAbsencePenalty(),
        SETTER_THRESHOLD: this.setterThreshold() ?? undefined,
        SETTER_ABSENCE_PENALTY: this.setterAbsencePenalty(),
        GLOBAL_MEAN_PENALTY_FACTOR: this.globalMeanPenaltyFactor(),
        TEAM_DEFENSE_PENALTY_FACTOR: this.teamDefensePenaltyFactor(),
        TOGETHER_PAIRS: this.togetherPairsList(),
        APART_PAIRS: this.apartPairsList(),
      },
    });
  }
}
