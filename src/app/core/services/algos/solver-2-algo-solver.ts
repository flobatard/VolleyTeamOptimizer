import { Player } from '../../models/player';
import { PlayerPair } from '../../models/player-pair';
import { PlayerTeamSizeConstraint } from '../../models/player-team-size-constraint';
import { computeOptimalNumTeams } from '../team-distribution';

export interface Solver2Params {
  KILLER_THRESHOLD?: number;
  PASSER_THRESHOLD?: number;
  /** Coefficient d'impact des filles pour l'équilibrage (0.1–1). */
  FEMALE_IMPACT_COEF?: number;
  /** Nombre de tentatives de restart si le delta n'est pas atteint */
  MAX_ATTEMPTS?: number;
  FORCE_EVEN_TEAMS?: boolean;
  /** Écart max autorisé entre les moyennes de score global des équipes. 0 = pas de contrainte. */
  MAX_GLOBAL_DELTA?: number;
  NUM_TEAMS?: number;
  TOGETHER_PAIRS?: PlayerPair[];
  APART_PAIRS?: PlayerPair[];
  PLAYER_TEAM_SIZE_CONSTRAINTS?: PlayerTeamSizeConstraint[];
}

/**
 * Algorithme construction + recherche locale par échanges de clusters :
 * 1. Construction : place les joueurs en respectant les contraintes dures
 *    (paires ensemble/séparés, répartition de genre, capitaines, taille d'équipe).
 * 2. Recherche locale : échange des clusters (groupes de joueurs liés par "ensemble")
 *    entre équipes pour minimiser l'écart de niveau (maxGap) tout en maintenant
 *    toutes les contraintes dures.
 * 3. Restart : si le delta cible n'est pas atteint, relance depuis une nouvelle
 *    construction aléatoire (jusqu'à MAX_RESTARTS fois).
 */
export class Solver2AlgoSolver {
  private static readonly DEFAULT_MAX_RESTARTS = 100;
  private static readonly LOCAL_SEARCH_ITER = 3000;
  private static readonly LOCAL_SEARCH_MAX_NO_IMPROVEMENT = 1000;
  private static readonly DEFAULT_MAX_GLOBAL_DELTA = 2;
  private static readonly DEFAULT_FEMALE_IMPACT_COEF = 1;

  generateTeams(
    players: Player[],
    targetTeamSize: number,
    params: Solver2Params = {},
    onProgress?: (percent: number) => void
  ): { teams: Player[][]; attemptCount: number; valid: boolean } {
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

    // Pré-calculer les clusters de filles liées "ensemble" (constant entre les restarts)
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const girlTogetherPairs = togetherPairs.filter(
      (pair) => playerMap.get(pair.player1Id)?.gender === 'F' && playerMap.get(pair.player2Id)?.gender === 'F'
    );
    const girlClusters = this.buildTogetherClusters(girlTogetherPairs, playerMap);
    const maxGirlClusterSize = girlClusters.reduce((max, c) => Math.max(max, c.length), 1);

    // Apart pairs : set pour lookup O(1)
    const apartSet = new Set<string>(
      apartPairs.map((p) => `${Math.min(p.player1Id, p.player2Id)}-${Math.max(p.player1Id, p.player2Id)}`)
    );
    const haveApartPair = (a: number, b: number): boolean =>
      apartSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

    let bestTeams: Player[][] | null = null;
    let bestGap = Infinity;

    for (let attempt = 0; attempt < maxRestarts; attempt++) {
      if (onProgress && attempt % 5 === 0) {
        onProgress(Math.min(99, Math.round((attempt / maxRestarts) * 100)));
      }

      // Phase 1 : construction d'une solution valide
      const buildResult = this.buildTeamsWithGenderAndPairs(
        players,
        numTeams,
        numGirls,
        numCaptains,
        togetherPairs,
        apartPairs,
        girlClusters
      );
      if (!buildResult.valid) continue;
      const builtTeams = buildResult.teams;

      if (!this.isGenderValid(builtTeams, numGirls, numTeams, maxGirlClusterSize)) continue;
      if (numCaptains > 0 && !this.isCaptainValid(builtTeams, numCaptains, numTeams)) continue;
      if (!this.isTeamSizeValid(builtTeams, playerTeamSizeConstraints)) continue;

      // Phase 2 : recherche locale par échanges de clusters
      const optimized = this.localSearch(
        builtTeams,
        togetherPairs,
        femaleImpactCoef,
        numGirls,
        numCaptains,
        numTeams,
        maxGirlClusterSize,
        haveApartPair
      );

      const gap = maxGlobalDelta > 0 ? this.maxGap(this.computeTeamStats(optimized, femaleImpactCoef)) : 0;

      if (gap < bestGap) {
        bestGap = gap;
        bestTeams = optimized;
      }

      if (maxGlobalDelta === 0 || gap <= maxGlobalDelta) {
        if (onProgress) onProgress(100);
        return { teams: optimized, attemptCount: attempt + 1, valid: true };
      }
    }

    if (onProgress) onProgress(100);
    const fallbackTeams = bestTeams ?? this.chunkIntoTeams(this.shuffle([...players]), numTeams);
    return { teams: fallbackTeams, attemptCount: maxRestarts, valid: false };
  }

  // ─── Recherche locale ────────────────────────────────────────────────────────

  /**
   * Échange des clusters entre équipes pour minimiser maxGap.
   * Un cluster est un groupe de joueurs liés par des paires "ensemble" (ou un joueur isolé).
   * Chaque échange est validé (contraintes apart, genre, capitaine) avant d'être accepté.
   * Seuls les échanges améliorants sont retenus (descente de gradient).
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
      // Tirer deux équipes distinctes au hasard
      const t1 = Math.floor(Math.random() * numTeams);
      let t2 = Math.floor(Math.random() * (numTeams - 1));
      if (t2 >= t1) t2++;

      const clusters1 = clustersByTeam[t1];
      const clusters2 = clustersByTeam[t2];
      if (clusters1.length === 0 || clusters2.length === 0) {
        noImprovementCount++;
        continue;
      }

      // Tirer un cluster de t1, puis un de même taille dans t2
      const c1 = clusters1[Math.floor(Math.random() * clusters1.length)];
      const c2Candidates = clusters2.filter((c) => c.length === c1.length && c !== c1);
      if (c2Candidates.length === 0) {
        noImprovementCount++;
        continue;
      }
      const c2 = c2Candidates[Math.floor(Math.random() * c2Candidates.length)];

      if (
        !this.isSwapValid(
          c1, c2, t1, t2, teams,
          girlCounts, captainCounts,
          numGirls, numTeams, numCaptains, maxGirlClusterSize,
          haveApartPair
        )
      ) {
        noImprovementCount++;
        continue;
      }

      // Appliquer l'échange et évaluer
      this.applySwap(teams, clustersByTeam, girlCounts, captainCounts, t1, t2, c1, c2);
      const newStats = this.computeTeamStatsForTeams(teams, femaleImpactCoef, currentStats, t1, t2);
      const newScore = this.maxGap(newStats);

      if (newScore < currentScore - 1e-9) {
        currentStats = newStats;
        currentScore = newScore;
        noImprovementCount = 0;
      } else {
        // Annuler l'échange
        this.applySwap(teams, clustersByTeam, girlCounts, captainCounts, t1, t2, c2, c1);
        noImprovementCount++;
      }
    }

    return teams;
  }

  /**
   * Vérifie si l'échange de c1 (équipe t1) ↔ c2 (équipe t2) est valide :
   * paires séparées, répartition de genre, répartition de capitaines.
   */
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
          const mx = Math.max(...newCounts);
          const mn = Math.min(...newCounts);
          if (mn === 0 || mx - mn > 1) return false;
        }
      }
    }

    return true;
  }

  /** Applique l'échange de c1 (t1) ↔ c2 (t2) sur les structures de données. */
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

    const idx1 = clustersByTeam[t1].indexOf(c1);
    clustersByTeam[t1][idx1] = c2;
    const idx2 = clustersByTeam[t2].indexOf(c2);
    clustersByTeam[t2][idx2] = c1;

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

  /**
   * Construit la liste des clusters par équipe.
   * Un cluster = groupe de joueurs liés par des paires "ensemble" (union-find),
   * ou un joueur isolé (cluster singleton).
   */
  private buildClustersByTeam(teams: Player[][], togetherPairs: PlayerPair[]): Player[][][] {
    const allPlayers = teams.flat();
    const parent = new Map<number, number>(allPlayers.map((p) => [p.id, p.id]));

    const find = (id: number): number => {
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const pair of togetherPairs) {
      if (parent.has(pair.player1Id) && parent.has(pair.player2Id)) {
        union(pair.player1Id, pair.player2Id);
      }
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

  /**
   * Construit une répartition en respectant les contraintes dures :
   * 1a. Clusters de filles liées "ensemble" → placés dans la même équipe.
   * 1b. Filles isolées → réparties greedily (équipe avec le moins de filles en premier).
   * 2.  Capitaines non encore placés.
   * 3.  Clusters "ensemble" complets (fermeture transitive).
   * 4.  Paires "séparés".
   * 5.  Joueurs restants (aléatoire).
   */
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

    const teamSizes: number[] = [];
    const remainder = n % numTeams;
    const baseSize = Math.floor(n / numTeams);
    for (let t = 0; t < numTeams; t++) {
      teamSizes.push(t < remainder ? baseSize + 1 : baseSize);
    }

    const teams: Player[][] = teamSizes.map(() => []);
    const playerToTeam = new Map<number, number>();
    const freeSlots = (t: number) => teamSizes[t] - teams[t].length;

    // 1a. Clusters de filles ensemble (priorité sur la répartition de genre)
    for (const cluster of girlClusters) {
      const clusterPlayers = cluster.map((id) => playerMap.get(id)!).filter(Boolean);
      const candidates = [...Array(numTeams).keys()].filter((t) => freeSlots(t) >= clusterPlayers.length);
      if (candidates.length === 0) return { teams, valid: false };
      const teamIdx = candidates[Math.floor(Math.random() * candidates.length)];
      for (const g of clusterPlayers) {
        teams[teamIdx].push(g);
        playerToTeam.set(g.id, teamIdx);
      }
    }

    // 1b. Filles isolées : greedy vers l'équipe avec le moins de filles
    if (numGirls > 0) {
      const clusteredGirlIds = new Set(girlClusters.flat());
      const singleGirls = this.shuffle(players.filter((p) => p.gender === 'F' && !clusteredGirlIds.has(p.id)));
      for (const girl of singleGirls) {
        let minCount = Infinity;
        let bestTeam = -1;
        const order = this.shuffle([...Array(numTeams).keys()]);
        for (const t of order) {
          if (freeSlots(t) <= 0) continue;
          const gc = teams[t].filter((p) => p.gender === 'F').length;
          if (gc < minCount) {
            minCount = gc;
            bestTeam = t;
          }
        }
        if (bestTeam === -1) return { teams, valid: false };
        teams[bestTeam].push(girl);
        playerToTeam.set(girl.id, bestTeam);
      }
    }

    // 2. Capitaines non encore placés
    if (numCaptains > 0) {
      const unplacedCaptains = this.shuffle(players.filter((p) => p.isCaptain && !playerToTeam.has(p.id)));
      if (unplacedCaptains.length > 0) {
        const nc = unplacedCaptains.length;
        if (nc <= numTeams) {
          const teamIndices =
            nc < numTeams
              ? this.shuffle([...Array(numTeams).keys()]).slice(0, nc)
              : this.shuffle([...Array(numTeams).keys()]);
          for (let i = 0; i < nc; i++) {
            teams[teamIndices[i]].push(unplacedCaptains[i]);
            playerToTeam.set(unplacedCaptains[i].id, teamIndices[i]);
          }
        } else {
          const capPerTeam = Math.floor(nc / numTeams);
          const extraTeams = nc % numTeams;
          const teamOrder = this.shuffle([...Array(numTeams).keys()]);
          let capIdx = 0;
          for (let i = 0; i < numTeams; i++) {
            const t = teamOrder[i];
            const count = i < extraTeams ? capPerTeam + 1 : capPerTeam;
            for (let j = 0; j < count; j++) {
              teams[t].push(unplacedCaptains[capIdx]);
              playerToTeam.set(unplacedCaptains[capIdx].id, t);
              capIdx++;
            }
          }
        }
      }
    }

    // 3. Clusters "ensemble" complets
    const togetherClusters = this.buildTogetherClusters(togetherPairs, playerMap);
    for (const cluster of togetherClusters) {
      const placed = cluster.filter((pid) => playerToTeam.has(pid));
      const unplaced = cluster.filter((pid) => !playerToTeam.has(pid));
      if (unplaced.length === 0) {
        const placedTeams = new Set(placed.map((pid) => playerToTeam.get(pid)));
        if (placedTeams.size > 1) return { teams, valid: false };
        continue;
      }
      let teamIdx: number;
      if (placed.length > 0) {
        const placedTeams = new Set(placed.map((pid) => playerToTeam.get(pid)));
        if (placedTeams.size > 1) return { teams, valid: false };
        teamIdx = playerToTeam.get(placed[0])!;
        if (freeSlots(teamIdx) < unplaced.length) return { teams, valid: false };
      } else {
        const forbiddenTeams = new Set<number>();
        for (const pid of cluster) {
          for (const pair of apartPairs) {
            const other =
              pair.player1Id === pid ? pair.player2Id : pair.player2Id === pid ? pair.player1Id : null;
            if (other !== null && playerMap.has(other)) {
              const otherTeam = playerToTeam.get(other);
              if (otherTeam !== undefined) forbiddenTeams.add(otherTeam);
            }
          }
        }
        const candidates = [...Array(numTeams).keys()].filter(
          (t) => freeSlots(t) >= cluster.length && !forbiddenTeams.has(t)
        );
        if (candidates.length === 0) return { teams, valid: false };
        teamIdx = candidates[Math.floor(Math.random() * candidates.length)];
      }
      for (const pid of unplaced) {
        const p = playerMap.get(pid);
        if (p) {
          teams[teamIdx].push(p);
          playerToTeam.set(pid, teamIdx);
        }
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
        teams[idx].push(p2);
        playerToTeam.set(pair.player2Id, idx);
      } else if (t2 !== undefined) {
        const others = [...Array(numTeams).keys()].filter((t) => t !== t2 && freeSlots(t) > 0);
        if (others.length === 0) return { teams, valid: false };
        const idx = others[Math.floor(Math.random() * others.length)];
        teams[idx].push(p1);
        playerToTeam.set(pair.player1Id, idx);
      } else {
        const available = [...Array(numTeams).keys()].filter((t) => freeSlots(t) >= 1);
        if (available.length < 2) return { teams, valid: false };
        const [tA, tB] = this.shuffle([...available]).slice(0, 2);
        teams[tA].push(p1);
        teams[tB].push(p2);
        playerToTeam.set(pair.player1Id, tA);
        playerToTeam.set(pair.player2Id, tB);
      }
    }

    // 5. Joueurs restants
    const remaining = this.shuffle(players.filter((p) => !playerToTeam.has(p.id)));
    let idx = 0;
    for (let t = 0; t < numTeams; t++) {
      while (teams[t].length < teamSizes[t]) {
        teams[t].push(remaining[idx++]);
      }
    }

    return { teams, valid: true };
  }

  // ─── Validation des contraintes dures ───────────────────────────────────────

  /**
   * Valide la répartition des filles.
   * - Aucune équipe ne dépasse max(ceil(numGirls/numTeams), maxGirlClusterSize) filles.
   * - Sans cluster de filles, toute équipe doit avoir ≥ 1 fille quand numGirls >= numTeams.
   */
  private isGenderValid(
    teams: Player[][],
    numGirls: number,
    numTeams: number,
    maxGirlClusterSize: number
  ): boolean {
    if (numGirls === 0) return true;
    const counts = teams.map((t) => t.filter((p) => p.gender === 'F').length);
    const idealMax = Math.max(Math.ceil(numGirls / numTeams), maxGirlClusterSize);
    if (Math.max(...counts) > idealMax) return false;
    if (numGirls >= numTeams && maxGirlClusterSize <= 1 && Math.min(...counts) === 0) return false;
    return true;
  }

  private isCaptainValid(teams: Player[][], numCaptains: number, numTeams: number): boolean {
    if (numCaptains < numTeams) {
      return !teams.some((t) => t.filter((p) => p.isCaptain).length > 1);
    }
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

  /** Recalcule les stats uniquement pour les deux équipes modifiées (optimisation). */
  private computeTeamStatsForTeams(
    teams: Player[][],
    femaleImpactCoef: number,
    prev: { global: number[]; defense: number[]; attack: number[]; set: number[] },
    t1: number, t2: number
  ): { global: number[]; defense: number[]; attack: number[]; set: number[] } {
    const stats = {
      global: [...prev.global],
      defense: [...prev.defense],
      attack: [...prev.attack],
      set: [...prev.set],
    };
    for (const t of [t1, t2]) {
      const team = teams[t];
      const len = team.length;
      stats.global[t] = team.reduce((s, p) => s + p.global_impact * this.weight(p, femaleImpactCoef), 0) / len;
      stats.defense[t] = team.reduce((s, p) => s + p.defense * this.weight(p, femaleImpactCoef), 0) / len;
      stats.attack[t] = team.reduce((s, p) => s + p.attack * this.weight(p, femaleImpactCoef), 0) / len;
      stats.set[t] = team.reduce((s, p) => s + p.set * this.weight(p, femaleImpactCoef), 0) / len;
    }
    return stats;
  }

  private maxGap(stats: { global: number[]; defense: number[]; attack: number[]; set: number[] }): number {
    const gap = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    return Math.max(gap(stats.global), gap(stats.defense), gap(stats.attack), gap(stats.set));
  }

  // ─── Utilitaires ─────────────────────────────────────────────────────────────

  /** Union-Find : regroupe les joueurs qui doivent être ensemble (fermeture transitive). */
  private buildTogetherClusters(togetherPairs: PlayerPair[], playerMap: Map<number, Player>): number[][] {
    const parent = new Map<number, number>();
    const find = (id: number): number => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const pair of togetherPairs) {
      if (playerMap.has(pair.player1Id) && playerMap.has(pair.player2Id)) {
        union(pair.player1Id, pair.player2Id);
      }
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
