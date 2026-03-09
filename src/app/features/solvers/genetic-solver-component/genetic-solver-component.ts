import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerDataService } from '../../../core/services/player-data.service';
import { Player } from '../../../core/models/player';
import { PlayerPair } from '../../../core/models/player-pair';
import { ListPairPlayers } from '../../../shared/list-pair-players/list-pair-players';

const STORAGE_KEY = 'VTO_genetic_solver_params';
const STORAGE_KEY_TEAMS = 'VTO_genetic_solver_teams';

interface PersistedParams {
  targetTeamSize: number;
  forceEvenTeams: boolean;
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
  targetTeamSize: 6,
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
    if (stored) return { ...DEFAULT_PARAMS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_PARAMS;
}

function loadTeams(): Player[][] {
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
  readonly teams = signal<Player[][]>(loadTeams());
  readonly isRunning = signal<boolean>(false);
  readonly workerError = signal<string | null>(null);
  readonly progress = signal<number>(0);

  private readonly p = loadParams();

  protected readonly targetTeamSize = signal(this.p.targetTeamSize);
  protected readonly forceEvenTeams = signal(this.p.forceEvenTeams);

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
      const params: PersistedParams = {
        targetTeamSize: this.targetTeamSize(),
        forceEvenTeams: this.forceEvenTeams(),
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

  run(): void {
    const selectedPlayers = this.players();
    const teamSize = this.targetTeamSize();
    if (selectedPlayers.length === 0) return;
    this.isRunning.set(true);
    this.workerError.set(null);
    this.progress.set(0);
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
        this.teams.set(data.teams);
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
