import { Player } from '../../models/player';
import { PlayerPair } from '../../models/player-pair';
import { PlayerTeamSizeConstraint } from '../../models/player-team-size-constraint';
import { computeOptimalNumTeams } from '../team-distribution';

export interface Solver2Params {
  KILLER_THRESHOLD?: number;
  PASSER_THRESHOLD?: number;
  /** Coefficient d'impact des filles pour l'équilibrage (0.1–1). */
  FEMALE_IMPACT_COEF?: number;
  /** Nombre de tentatives de restart pour la solution principale */
  MAX_ATTEMPTS?: number;
  FORCE_EVEN_TEAMS?: boolean;
  /** Écart max autorisé entre les moyennes de score global des équipes. 0 = pas de contrainte. */
  MAX_GLOBAL_DELTA?: number;
  NUM_TEAMS?: number;
  TOGETHER_PAIRS?: PlayerPair[];
  APART_PAIRS?: PlayerPair[];
  PLAYER_TEAM_SIZE_CONSTRAINTS?: PlayerTeamSizeConstraint[];
}

/** Une solution générée : équipes + écart max de niveau. */
export interface Solver2Solution {
  teams: Player[][];
  gap: number;
}

/** Contexte partagé entre toutes les tentatives d'une même génération. */
interface SearchCtx {
  players: Player[];
  numTeams: number;
  numGirls: number;
  numCaptains: number;
  togetherPairs: PlayerPair[];
  apartPairs: PlayerPair[];
  playerTeamSizeConstraints: PlayerTeamSizeConstraint[];
  girlClusters: number[][];
  maxGirlClusterSize: number;
  maxGlobalDelta: number;
  femaleImpactCoef: number;
  haveApartPair: (a: number, b: number) => boolean;
}

/**
 * Algorithme construction + recherche locale par échanges de clusters.
 *
 * Génère plusieurs solutions équilibrées et diversifiées :
 * 1. Construction : place les joueurs en respectant toutes les contraintes dures.
 * 2. Recherche locale : échanges de clusters pour minimiser maxGap.
 * 3. Multi-solutions : les alternatives sont suffisamment différentes de la principale
 *    (au moins 30 % des joueurs changent d'équipe entre deux solutions).
 */
export class Solver2AlgoSolver {
  private static readonly DEFAULT_MAX_RESTARTS = 100;
  /** Restarts alloués à chaque solution alternative */
  private static readonly ALT_RESTARTS = 40;
  /** Seuil de similarité : au-delà, deux solutions sont jugées trop proches (0–1) */
  private static readonly DIVERSITY_THRESHOLD = 0.70;
  private static readonly LOCAL_SEARCH_ITER = 3000;
  private static readonly LOCAL_SEARCH_MAX_NO_IMPROVEMENT = 1000;
  private static readonly DEFAULT_MAX_GLOBAL_DELTA = 2;
  private static readonly DEFAULT_FEMALE_IMPACT_COEF = 1;

  /**
   * Génère `numSolutions` répartitions (défaut 3).
   * solutions[0] est la meilleure trouvée, les suivantes sont des alternatives diversifiées.
   */
  generateTeams(
    players: Player[],
    targetTeamSize: number,
    params: Solver2Params = {},
    onProgress?: (percent: number) => void,
    numSolutions = 3
  ): { solutions: Solver2Solution[]; attemptCount: number; valid: boolean } {
    const maxRestarts = params.MAX_ATTEMPTS ?? Solver2AlgoSolver.DEFAULT_MAX_RESTARTS;
    const forceEvenTeams = params.FORCE_EVEN_TEAMS ?? false;
    const maxGlobalDelta = params.MAX_GLOBAL_DELTA ?? Solver2AlgoSolver.DEFAULT_MAX_GLOBAL_DELTA;
    const femaleImpactCoef = Math.max(
      0.1,
      Math.min(1, params.FEMALE_IMPACT_COEF ?? Solver2AlgoSolver.DEFAULT_FEMALE_IMPACT_COEF)
    );

    const numTeams = params.NUM_TEAMS ?? computeOptimalNumTeams(players.length, targetTeamSize, forceEvenTeams);
    const numGirls = players.filter((p) => p.gender === 'F').length;
    const numCaptains = players.filter((p) => p.isCaptain).length;

    const togetherPairs = (params.TOGETHER_PAIRS ?? []).filter(
      (p) => players.some((x) => x.id === p.player1Id) && players.some((x) => x.id === p.player2Id)
    );
    const apartPairs = (params.APART_PAIRS ?? []).filter(
      (p) => players.some((x) => x.id === p.player1Id) && players.some((x) => x.id === p.player2Id)
    );
    const playerTeamSizeConstraints = (params.PLAYER_TEAM_SIZE_CONSTRAINTS ?? []).filter((c) =>
      players.some((x) => x.id === c.playerId)
    );

    const playerMap = new Map(players.map((p) => [p.id, p]));
    const girlTogetherPairs = togetherPairs.filter(
      (pair) => playerMap.get(pair.player1Id)?.gender === 'F' && playerMap.get(pair.player2Id)?.gender === 'F'
    );
    const girlClusters = this.buildTogetherClusters(girlTogetherPairs, playerMap);
    const maxGirlClusterSize = girlClusters.reduce((max, c) => Math.max(max, c.length), 1);

    const apartSet = new Set<string>(
      apartPairs.map((p) => `${Math.min(p.player1Id, p.player2Id)}-${Math.max(p.player1Id, p.player2Id)}`)
    );
    const haveApartPair = (a: number, b: number): boolean =>
      apartSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

    const ctx: SearchCtx = {
      players, numTeams, numGirls, numCaptains,
      togetherPairs, apartPairs, playerTeamSizeConstraints,
      girlClusters, maxGirlClusterSize,
      maxGlobalDelta, femaleImpactCoef, haveApartPair,
    };

    // ── Solution principale : meilleure sur maxRestarts tentatives ──────────
    const primaryResult = this.runSearch(ctx, maxRestarts, (attempt) => {
      if (onProgress && attempt % 5 === 0) {
        onProgress(Math.min(59, Math.round((attempt / maxRestarts) * 60)));
      }
    });

    const fallback: Solver2Solution = {
      teams: this.chunkIntoTeams(this.shuffle([...players]), numTeams),
      gap: Infinity,
    };
    const solutions: Solver2Solution[] = [primaryResult.solution ?? fallback];

    // ── Solutions alternatives : diversifiées ───────────────────────────────
    const altRestarts = Solver2AlgoSolver.ALT_RESTARTS;
    for (let altIdx = 1; altIdx < numSolutions; altIdx++) {
      const progressBase = 60 + (altIdx - 1) * 20;
      let bestAlt: Solver2Solution | null = null;

      for (let attempt = 0; attempt < altRestarts; attempt++) {
        if (onProgress && attempt % 5 === 0) {
          onProgress(Math.min(progressBase + 19, progressBase + Math.round((attempt / altRestarts) * 20)));
        }

        const candidate = this.buildAndOptimize(ctx);
        if (!candidate) continue;

        const tooSimilar = solutions.some(
          (s) => this.solutionSimilarity(s.teams, candidate.teams) > Solver2AlgoSolver.DIVERSITY_THRESHOLD
        );

        if (!tooSimilar) {
          // Candidat diversifié : garder le meilleur
          if (bestAlt === null || candidate.gap < bestAlt.gap) bestAlt = candidate;
          if (maxGlobalDelta === 0 || candidate.gap <= maxGlobalDelta) break;
        } else if (bestAlt === null) {
          // Fallback : on prend quand même pour ne pas laisser un slot vide
          bestAlt = candidate;
        }
      }

      if (bestAlt) solutions.push(bestAlt);
    }

    if (onProgress) onProgress(100);

    const primarySolution = solutions[0];
    const primaryValid =
      primarySolution.gap !== Infinity &&
      (maxGlobalDelta === 0 || primarySolution.gap <= maxGlobalDelta);

    return { solutions, attemptCount: primaryResult.attemptCount, valid: primaryValid };
  }

  // ─── Recherche interne ───────────────────────────────────────────────────────

  private runSearch(
    ctx: SearchCtx,
    maxRestarts: number,
    onAttempt?: (attempt: number) => void
  ): { solution: Solver2Solution | null; attemptCount: number } {
    let best: Solver2Solution | null = null;
    let bestAttemptCount = maxRestarts;

    for (let attempt = 0; attempt < maxRestarts; attempt++) {
      onAttempt?.(attempt);
      const candidate = this.buildAndOptimize(ctx);
      if (!candidate) continue;

      if (best === null || candidate.gap < best.gap) {
        best = candidate;
        bestAttemptCount = attempt + 1;
      }
      if (ctx.maxGlobalDelta === 0 || candidate.gap <= ctx.maxGlobalDelta) break;
    }
    return { solution: best, attemptCount: bestAttemptCount };
  }

  /** Construction + recherche locale pour une tentative. Null si la construction échoue. */
  private buildAndOptimize(ctx: SearchCtx): Solver2Solution | null {
    const { players, numTeams, numGirls, numCaptains,
            togetherPairs, apartPairs, playerTeamSizeConstraints,
            girlClusters, maxGirlClusterSize,
            maxGlobalDelta, femaleImpactCoef, haveApartPair } = ctx;

    const buildResult = this.buildTeamsWithGenderAndPairs(
      players, numTeams, numGirls, numCaptains, togetherPairs, apartPairs, girlClusters
    );
    if (!buildResult.valid) return null;

    if (!this.isGenderValid(buildResult.teams, numGirls, numTeams, maxGirlClusterSize)) return null;
    if (numCaptains > 0 && !this.isCaptainValid(buildResult.teams, numCaptains, numTeams)) return null;
    if (!this.isTeamSizeValid(buildResult.teams, playerTeamSizeConstraints)) return null;

    const optimized = this.localSearch(
      buildResult.teams, togetherPairs, femaleImpactCoef,
      numGirls, numCaptains, numTeams, maxGirlClusterSize, haveApartPair
    );

    const gap = maxGlobalDelta > 0 ? this.maxGap(this.computeTeamStats(optimized, femaleImpactCoef)) : 0;
    return { teams: optimized, gap };
  }

  /**
   * Similarité entre deux solutions (invariante à l'ordre des équipes, 0–1).
   * Fait correspondre chaque équipe de sol1 à son meilleur jumeau dans sol2 (greedy),
   * puis retourne le ratio joueurs-en-commun / total.
   */
  private solutionSimilarity(sol1: Player[][], sol2: Player[][]): number {
    const total = sol1.flat().length;
    if (total === 0) return 1;
    let overlap = 0;
    const matched = new Set<number>();
    for (const team1 of sol1) {
      const ids1 = new Set(team1.map((p) => p.id));
      let best = 0;
      let bestIdx = -1;
      for (let j = 0; j < sol2.length; j++) {
        if (matched.has(j)) continue;
        const o = sol2[j].filter((p) => ids1.has(p.id)).length;
        if (o > best) { best = o; bestIdx = j; }
      }
      if (bestIdx >= 0) { matched.add(bestIdx); overlap += best; }
    }
    return overlap / total;
  }

  // ─── Recherche locale ────────────────────────────────────────────────────────

  /**
   * Échange des clusters entre équipes pour minimiser maxGap.
   * Un cluster = groupe de joueurs liés "ensemble" (ou joueur isolé).
   * Seuls les échanges améliorants sont acceptés (descente de gradient).
   */
  private localSearch(
    teams: Player[][],
    togetherPairs: PlayerPair[],
    femaleImpactCoef: number,
    numGirls: number,
    numCaptains: number,
    numTeams: number,
    maxGirlClusterSize: number,
    haveApartPair: (a: number, b: number) => boolean
  ): Player[][] {
    if (numTeams < 2) return teams;

    const clustersByTeam = this.buildClustersByTeam(teams, togetherPairs);
    const girlCounts = teams.map((t) => t.filter((p) => p.gender === 'F').length);
    const captainCounts = numCaptains > 0 ? teams.map((t) => t.filter((p) => p.isCaptain).length) : null;

    let currentStats = this.computeTeamStats(teams, femaleImpactCoef);
    let currentScore = this.maxGap(currentStats);

    const MAX_ITER = Solver2AlgoSolver.LOCAL_SEARCH_ITER;
    const MAX_NO_IMPROVEMENT = Solver2AlgoSolver.LOCAL_SEARCH_MAX_NO_IMPROVEMENT;
    let noImprovementCount = 0;

    for (let iter = 0; iter < MAX_ITER && noImprovementCount < MAX_NO_IMPROVEMENT; iter++) {
      const t1 = Math.floor(Math.random() * numTeams);
      let t2 = Math.floor(Math.random() * (numTeams - 1));
      if (t2 >= t1) t2++;

      const clusters1 = clustersByTeam[t1];
      const clusters2 = clustersByTeam[t2];
      if (clusters1.length === 0 || clusters2.length === 0) { noImprovementCount++; continue; }

      const c1 = clusters1[Math.floor(Math.random() * clusters1.length)];
      const c2Candidates = clusters2.filter((c) => c.length === c1.length && c !== c1);
      if (c2Candidates.length === 0) { noImprovementCount++; continue; }
      const c2 = c2Candidates[Math.floor(Math.random() * c2Candidates.length)];

      if (!this.isSwapValid(c1, c2, t1, t2, teams, girlCounts, captainCounts,
                            numGirls, numTeams, numCaptains, maxGirlClusterSize, haveApartPair)) {
        noImprovementCount++;
        continue;
      }

      this.applySwap(teams, clustersByTeam, girlCounts, captainCounts, t1, t2, c1, c2);
      const newStats = this.computeTeamStatsForTeams(teams, femaleImpactCoef, currentStats, t1, t2);
      const newScore = this.maxGap(newStats);

      if (newScore < currentScore - 1e-9) {
        currentStats = newStats;
        currentScore = newScore;
        noImprovementCount = 0;
      } else {
        this.applySwap(teams, clustersByTeam, girlCounts, captainCounts, t1, t2, c2, c1);
        noImprovementCount++;
      }
    }

    return teams;
  }

  private isSwapValid(
    c1: Player[], c2: Player[],
    t1: number, t2: number,
    teams: Player[][],
    girlCounts: number[], captainCounts: number[] | null,
    numGirls: number, numTeams: number, numCaptains: number,
    maxGirlClusterSize: number,
    haveApartPair: (a: number, b: number) => boolean
  ): boolean {
    const c2Ids = new Set(c2.map((p) => p.id));
    for (const p1 of c1) {
      for (const p2 of teams[t2]) {
        if (!c2Ids.has(p2.id) && haveApartPair(p1.id, p2.id)) return false;
      }
    }
    const c1Ids = new Set(c1.map((p) => p.id));
    for (const p2 of c2) {
      for (const p1 of teams[t1]) {
        if (!c1Ids.has(p1.id) && haveApartPair(p1.id, p2.id)) return false;
      }
    }

    const c1Girls = c1.filter((p) => p.gender === 'F').length;
    const c2Girls = c2.filter((p) => p.gender === 'F').length;
    if (c1Girls !== c2Girls) {
      const newCounts = [...girlCounts];
      newCounts[t1] = girlCounts[t1] - c1Girls + c2Girls;
      newCounts[t2] = girlCounts[t2] - c2Girls + c1Girls;
      const idealMax = Math.max(Math.ceil(numGirls / numTeams), maxGirlClusterSize);
      if (Math.max(...newCounts) > idealMax) return false;
      if (numGirls >= numTeams && maxGirlClusterSize <= 1 && Math.min(...newCounts) === 0) return false;
    }

    if (captainCounts) {
      const c1Caps = c1.filter((p) => p.isCaptain).length;
      const c2Caps = c2.filter((p) => p.isCaptain).length;
      if (c1Caps !== c2Caps) {
        const newCounts = [...captainCounts];
        newCounts[t1] = captainCounts[t1] - c1Caps + c2Caps;
        newCounts[t2] = captainCounts[t2] - c2Caps + c1Caps;
        if (numCaptains < numTeams) {
          if (newCounts[t1] > 1 || newCounts[t2] > 1) return false;
        } else {
          if (Math.min(...newCounts) === 0 || Math.max(...newCounts) - Math.min(...newCounts) > 1) return false;
        }
      }
    }

    return true;
  }

  private applySwap(
    teams: Player[][],
    clustersByTeam: Player[][][],
    girlCounts: number[],
    captainCounts: number[] | null,
    t1: number, t2: number,
    c1: Player[], c2: Player[]
  ): void {
    const c1Ids = new Set(c1.map((p) => p.id));
    const c2Ids = new Set(c2.map((p) => p.id));
    teams[t1] = [...teams[t1].filter((p) => !c1Ids.has(p.id)), ...c2];
    teams[t2] = [...teams[t2].filter((p) => !c2Ids.has(p.id)), ...c1];
    clustersByTeam[t1][clustersByTeam[t1].indexOf(c1)] = c2;
    clustersByTeam[t2][clustersByTeam[t2].indexOf(c2)] = c1;
    const c1Girls = c1.filter((p) => p.gender === 'F').length;
    const c2Girls = c2.filter((p) => p.gender === 'F').length;
    girlCounts[t1] += c2Girls - c1Girls;
    girlCounts[t2] += c1Girls - c2Girls;
    if (captainCounts) {
      const c1Caps = c1.filter((p) => p.isCaptain).length;
      const c2Caps = c2.filter((p) => p.isCaptain).length;
      captainCounts[t1] += c2Caps - c1Caps;
      captainCounts[t2] += c1Caps - c2Caps;
    }
  }

  private buildClustersByTeam(teams: Player[][], togetherPairs: PlayerPair[]): Player[][][] {
    const allPlayers = teams.flat();
    const parent = new Map<number, number>(allPlayers.map((p) => [p.id, p.id]));
    const find = (id: number): number => {
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const pair of togetherPairs) {
      if (parent.has(pair.player1Id) && parent.has(pair.player2Id)) union(pair.player1Id, pair.player2Id);
    }
    return teams.map((team) => {
      const groups = new Map<number, Player[]>();
      for (const p of team) {
        const root = find(p.id);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(p);
      }
      return [...groups.values()];
    });
  }

  // ─── Construction initiale ───────────────────────────────────────────────────

  private buildTeamsWithGenderAndPairs(
    players: Player[],
    numTeams: number,
    numGirls: number,
    numCaptains: number,
    togetherPairs: PlayerPair[],
    apartPairs: PlayerPair[],
    girlClusters: number[][]
  ): { teams: Player[][]; valid: boolean } {
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const n = players.length;
    const remainder = n % numTeams;
    const baseSize = Math.floor(n / numTeams);
    const teamSizes = Array.from({ length: numTeams }, (_, t) => t < remainder ? baseSize + 1 : baseSize);

    const teams: Player[][] = teamSizes.map(() => []);
    const playerToTeam = new Map<number, number>();
    const freeSlots = (t: number) => teamSizes[t] - teams[t].length;

    // 1a. Clusters de filles ensemble
    for (const cluster of girlClusters) {
      const clusterPlayers = cluster.map((id) => playerMap.get(id)!).filter(Boolean);
      const candidates = [...Array(numTeams).keys()].filter((t) => freeSlots(t) >= clusterPlayers.length);
      if (candidates.length === 0) return { teams, valid: false };
      const teamIdx = candidates[Math.floor(Math.random() * candidates.length)];
      for (const g of clusterPlayers) { teams[teamIdx].push(g); playerToTeam.set(g.id, teamIdx); }
    }

    // 1b. Filles isolées : greedy vers l'équipe avec le moins de filles
    if (numGirls > 0) {
      const clusteredIds = new Set(girlClusters.flat());
      const singleGirls = this.shuffle(players.filter((p) => p.gender === 'F' && !clusteredIds.has(p.id)));
      for (const girl of singleGirls) {
        let minCount = Infinity;
        let bestTeam = -1;
        for (const t of this.shuffle([...Array(numTeams).keys()])) {
          if (freeSlots(t) <= 0) continue;
          const gc = teams[t].filter((p) => p.gender === 'F').length;
          if (gc < minCount) { minCount = gc; bestTeam = t; }
        }
        if (bestTeam === -1) return { teams, valid: false };
        teams[bestTeam].push(girl);
        playerToTeam.set(girl.id, bestTeam);
      }
    }

    // 2. Capitaines non encore placés
    if (numCaptains > 0) {
      const unplaced = this.shuffle(players.filter((p) => p.isCaptain && !playerToTeam.has(p.id)));
      if (unplaced.length > 0) {
        const nc = unplaced.length;
        if (nc <= numTeams) {
          const indices = nc < numTeams
            ? this.shuffle([...Array(numTeams).keys()]).slice(0, nc)
            : this.shuffle([...Array(numTeams).keys()]);
          for (let i = 0; i < nc; i++) { teams[indices[i]].push(unplaced[i]); playerToTeam.set(unplaced[i].id, indices[i]); }
        } else {
          const perTeam = Math.floor(nc / numTeams);
          const extra = nc % numTeams;
          const order = this.shuffle([...Array(numTeams).keys()]);
          let ci = 0;
          for (let i = 0; i < numTeams; i++) {
            const t = order[i];
            const count = i < extra ? perTeam + 1 : perTeam;
            for (let j = 0; j < count; j++) { teams[t].push(unplaced[ci]); playerToTeam.set(unplaced[ci].id, t); ci++; }
          }
        }
      }
    }

    // 3. Clusters "ensemble" complets
    for (const cluster of this.buildTogetherClusters(togetherPairs, playerMap)) {
      const placed = cluster.filter((pid) => playerToTeam.has(pid));
      const unplaced = cluster.filter((pid) => !playerToTeam.has(pid));
      if (unplaced.length === 0) {
        if (new Set(placed.map((pid) => playerToTeam.get(pid))).size > 1) return { teams, valid: false };
        continue;
      }
      let teamIdx: number;
      if (placed.length > 0) {
        const placedTeams = new Set(placed.map((pid) => playerToTeam.get(pid)));
        if (placedTeams.size > 1) return { teams, valid: false };
        teamIdx = playerToTeam.get(placed[0])!;
        if (freeSlots(teamIdx) < unplaced.length) return { teams, valid: false };
      } else {
        const forbidden = new Set<number>();
        for (const pid of cluster) {
          for (const pair of apartPairs) {
            const other = pair.player1Id === pid ? pair.player2Id : pair.player2Id === pid ? pair.player1Id : null;
            if (other !== null && playerMap.has(other)) {
              const ot = playerToTeam.get(other);
              if (ot !== undefined) forbidden.add(ot);
            }
          }
        }
        const cands = [...Array(numTeams).keys()].filter((t) => freeSlots(t) >= cluster.length && !forbidden.has(t));
        if (cands.length === 0) return { teams, valid: false };
        teamIdx = cands[Math.floor(Math.random() * cands.length)];
      }
      for (const pid of unplaced) {
        const p = playerMap.get(pid);
        if (p) { teams[teamIdx].push(p); playerToTeam.set(pid, teamIdx); }
      }
    }

    // 4. Paires "séparés"
    for (const pair of apartPairs) {
      const p1 = playerMap.get(pair.player1Id);
      const p2 = playerMap.get(pair.player2Id);
      if (!p1 || !p2) continue;
      const t1 = playerToTeam.get(pair.player1Id);
      const t2 = playerToTeam.get(pair.player2Id);
      if (t1 !== undefined && t2 !== undefined) {
        if (t1 === t2) return { teams, valid: false };
        continue;
      }
      if (t1 !== undefined) {
        const others = [...Array(numTeams).keys()].filter((t) => t !== t1 && freeSlots(t) > 0);
        if (others.length === 0) return { teams, valid: false };
        const idx = others[Math.floor(Math.random() * others.length)];
        teams[idx].push(p2); playerToTeam.set(pair.player2Id, idx);
      } else if (t2 !== undefined) {
        const others = [...Array(numTeams).keys()].filter((t) => t !== t2 && freeSlots(t) > 0);
        if (others.length === 0) return { teams, valid: false };
        const idx = others[Math.floor(Math.random() * others.length)];
        teams[idx].push(p1); playerToTeam.set(pair.player1Id, idx);
      } else {
        const available = [...Array(numTeams).keys()].filter((t) => freeSlots(t) >= 1);
        if (available.length < 2) return { teams, valid: false };
        const [tA, tB] = this.shuffle([...available]).slice(0, 2);
        teams[tA].push(p1); teams[tB].push(p2);
        playerToTeam.set(pair.player1Id, tA); playerToTeam.set(pair.player2Id, tB);
      }
    }

    // 5. Joueurs restants
    const remaining = this.shuffle(players.filter((p) => !playerToTeam.has(p.id)));
    let idx = 0;
    for (let t = 0; t < numTeams; t++) {
      while (teams[t].length < teamSizes[t]) teams[t].push(remaining[idx++]);
    }

    return { teams, valid: true };
  }

  // ─── Validation des contraintes dures ───────────────────────────────────────

  private isGenderValid(teams: Player[][], numGirls: number, numTeams: number, maxGirlClusterSize: number): boolean {
    if (numGirls === 0) return true;
    const counts = teams.map((t) => t.filter((p) => p.gender === 'F').length);
    const idealMax = Math.max(Math.ceil(numGirls / numTeams), maxGirlClusterSize);
    if (Math.max(...counts) > idealMax) return false;
    if (numGirls >= numTeams && maxGirlClusterSize <= 1 && Math.min(...counts) === 0) return false;
    return true;
  }

  private isCaptainValid(teams: Player[][], numCaptains: number, numTeams: number): boolean {
    if (numCaptains < numTeams) return !teams.some((t) => t.filter((p) => p.isCaptain).length > 1);
    const counts = teams.map((t) => t.filter((p) => p.isCaptain).length);
    return Math.min(...counts) >= 1 && Math.max(...counts) - Math.min(...counts) <= 1;
  }

  private isTeamSizeValid(teams: Player[][], constraints: PlayerTeamSizeConstraint[]): boolean {
    for (const c of constraints) {
      for (const team of teams) {
        if (c.excludedSizes.includes(team.length) && team.some((p) => p.id === c.playerId)) return false;
      }
    }
    return true;
  }

  // ─── Calcul des scores ───────────────────────────────────────────────────────

  private weight(p: Player, coef: number): number {
    return p.gender === 'F' ? coef : 1;
  }

  private computeTeamStats(
    teams: Player[][],
    femaleImpactCoef: number
  ): { global: number[]; defense: number[]; attack: number[]; set: number[] } {
    return {
      global: teams.map((t) => t.reduce((s, p) => s + p.global_impact * this.weight(p, femaleImpactCoef), 0) / t.length),
      defense: teams.map((t) => t.reduce((s, p) => s + p.defense * this.weight(p, femaleImpactCoef), 0) / t.length),
      attack: teams.map((t) => t.reduce((s, p) => s + p.attack * this.weight(p, femaleImpactCoef), 0) / t.length),
      set: teams.map((t) => t.reduce((s, p) => s + p.set * this.weight(p, femaleImpactCoef), 0) / t.length),
    };
  }

  private computeTeamStatsForTeams(
    teams: Player[][],
    femaleImpactCoef: number,
    prev: { global: number[]; defense: number[]; attack: number[]; set: number[] },
    t1: number, t2: number
  ): { global: number[]; defense: number[]; attack: number[]; set: number[] } {
    const s = { global: [...prev.global], defense: [...prev.defense], attack: [...prev.attack], set: [...prev.set] };
    for (const t of [t1, t2]) {
      const team = teams[t];
      const len = team.length;
      s.global[t] = team.reduce((a, p) => a + p.global_impact * this.weight(p, femaleImpactCoef), 0) / len;
      s.defense[t] = team.reduce((a, p) => a + p.defense * this.weight(p, femaleImpactCoef), 0) / len;
      s.attack[t] = team.reduce((a, p) => a + p.attack * this.weight(p, femaleImpactCoef), 0) / len;
      s.set[t] = team.reduce((a, p) => a + p.set * this.weight(p, femaleImpactCoef), 0) / len;
    }
    return s;
  }

  private maxGap(stats: { global: number[]; defense: number[]; attack: number[]; set: number[] }): number {
    const gap = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    return Math.max(gap(stats.global), gap(stats.defense), gap(stats.attack), gap(stats.set));
  }

  // ─── Utilitaires ─────────────────────────────────────────────────────────────

  private buildTogetherClusters(togetherPairs: PlayerPair[], playerMap: Map<number, Player>): number[][] {
    const parent = new Map<number, number>();
    const find = (id: number): number => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const pair of togetherPairs) {
      if (playerMap.has(pair.player1Id) && playerMap.has(pair.player2Id)) union(pair.player1Id, pair.player2Id);
    }
    const byRoot = new Map<number, number[]>();
    for (const [id] of parent) {
      const root = find(id);
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root)!.push(id);
    }
    return [...byRoot.values()].filter((c) => c.length >= 2);
  }

  private chunkIntoTeams(players: Player[], numTeams: number): Player[][] {
    const teams: Player[][] = Array.from({ length: numTeams }, () => []);
    players.forEach((p, i) => teams[i % numTeams].push(p));
    return teams;
  }

  private shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
