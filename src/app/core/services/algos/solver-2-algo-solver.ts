import { Player } from '../../models/player';
import { PlayerPair } from '../../models/player-pair';
import { PlayerTeamSizeConstraint } from '../../models/player-team-size-constraint';
import { computeOptimalNumTeams } from '../team-distribution';

export interface Solver2Params {
  /** Seuil attaque pour être considéré comme killer (défaut: 7) */
  KILLER_THRESHOLD?: number;
  /** Seuil passe pour être considéré comme passeur (défaut: 7) */
  PASSER_THRESHOLD?: number;
  /** Coefficient d'impact des filles pour l'équilibrage (0.1–1). 1 = égal aux garçons, 0.8 = une fille compte 80 % d'un garçon de même niveau. */
  FEMALE_IMPACT_COEF?: number;
  /** Nombre de tentatives de randomisation pour trouver une solution valide */
  MAX_ATTEMPTS?: number;
  /** Forcer un nombre pair d'équipes */
  FORCE_EVEN_TEAMS?: boolean;
  /** Écart max autorisé entre les moyennes de score global des équipes (défaut: 1). 0 = optimisation maximale. */
  MAX_GLOBAL_DELTA?: number;
  /** Nombre d'équipes à générer (override du calcul automatique) */
  NUM_TEAMS?: number;
  /** Paires de joueurs qui doivent jouer ensemble */
  TOGETHER_PAIRS?: PlayerPair[];
  /** Paires de joueurs qui ne doivent pas jouer ensemble */
  APART_PAIRS?: PlayerPair[];
  /** Contraintes de taille d'équipe par joueur (exclure certaines tailles) */
  PLAYER_TEAM_SIZE_CONSTRAINTS?: PlayerTeamSizeConstraint[];
}

/**
 * Algorithme par génération aléatoire : mélange les joueurs et répartit en équipes.
 * Si les conditions ne sont pas respectées (filles, paires, taille, delta), on régénère.
 * Killer et passeur ne sont pas obligatoires par équipe : attaque et passe sont équilibrées via le delta.
 */
export class Solver2AlgoSolver {
  private static readonly DEFAULT_KILLER_THRESHOLD = 7;
  private static readonly DEFAULT_PASSER_THRESHOLD = 7;
  private static readonly DEFAULT_MAX_ATTEMPTS = 10000;
  private static readonly DEFAULT_MAX_GLOBAL_DELTA = 2;
  private static readonly DEFAULT_FEMALE_IMPACT_COEF = 1;

  generateTeams(
    players: Player[],
    targetTeamSize: number,
    params: Solver2Params = {},
    onProgress?: (percent: number) => void
  ): { teams: Player[][]; attemptCount: number; valid: boolean } {
    const maxAttempts = params.MAX_ATTEMPTS ?? Solver2AlgoSolver.DEFAULT_MAX_ATTEMPTS;
    const forceEvenTeams = params.FORCE_EVEN_TEAMS ?? false;
    const maxGlobalDelta = params.MAX_GLOBAL_DELTA ?? Solver2AlgoSolver.DEFAULT_MAX_GLOBAL_DELTA;
    const femaleImpactCoef = Math.max(0.1, Math.min(1, params.FEMALE_IMPACT_COEF ?? Solver2AlgoSolver.DEFAULT_FEMALE_IMPACT_COEF));

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

    // Pré-calculer les clusters de filles liées par "ensemble" (constant entre les tentatives)
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const girlTogetherPairs = togetherPairs.filter(
      (pair) => playerMap.get(pair.player1Id)?.gender === 'F' && playerMap.get(pair.player2Id)?.gender === 'F'
    );
    const girlClusters = this.buildTogetherClusters(girlTogetherPairs, playerMap);
    // Taille max d'un cluster de filles (1 si aucun cluster)
    const maxGirlClusterSize = girlClusters.reduce((max, c) => Math.max(max, c.length), 1);

    let bestTeams: Player[][] | null = null;
    let bestInvalidCount = numTeams + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (onProgress && attempt % 10 === 0) {
        onProgress(Math.min(99, Math.round((attempt / maxAttempts) * 100)));
      }

      const teams = this.generateAndValidate(
        players,
        numTeams,
        numGirls,
        numCaptains,
        maxGlobalDelta,
        femaleImpactCoef,
        { togetherPairs, apartPairs, playerTeamSizeConstraints },
        girlClusters,
        maxGirlClusterSize
      );

      if (teams.valid) {
        if (onProgress) onProgress(100);
        return { teams: teams.teams, attemptCount: attempt + 1, valid: true };
      }

      if (teams.invalidCount < bestInvalidCount) {
        bestInvalidCount = teams.invalidCount;
        bestTeams = teams.teams;
      }
    }

    if (onProgress) onProgress(100);
    const fallbackTeams = bestTeams ?? this.chunkIntoTeams(this.shuffle([...players]), numTeams);
    return { teams: fallbackTeams, attemptCount: maxAttempts, valid: false };
  }

  /**
   * Génère une répartition : place d'abord les filles selon les règles, puis les garçons aléatoirement.
   * Vérifie ensuite les autres conditions (paires, taille, delta).
   */
  private generateAndValidate(
    players: Player[],
    numTeams: number,
    numGirls: number,
    numCaptains: number,
    maxGlobalDelta: number,
    femaleImpactCoef: number,
    constraintParams: {
      togetherPairs: PlayerPair[];
      apartPairs: PlayerPair[];
      playerTeamSizeConstraints: PlayerTeamSizeConstraint[];
    },
    girlClusters: number[][],
    maxGirlClusterSize: number
  ): { teams: Player[][]; valid: boolean; invalidCount: number } {
    const buildResult = this.buildTeamsWithGenderAndPairs(
      players,
      numTeams,
      numGirls,
      numCaptains,
      constraintParams.togetherPairs,
      constraintParams.apartPairs,
      girlClusters
    );
    if (!buildResult.valid) {
      return { teams: buildResult.teams, valid: false, invalidCount: 1 };
    }
    const teams = buildResult.teams;

    if (!this.isGenderValid(teams, numGirls, numTeams, maxGirlClusterSize)) {
      return { teams, valid: false, invalidCount: 1 };
    }

    if (numCaptains > 0) {
      const captainOk =
        numCaptains < numTeams
          ? !this.hasCaptainImbalance(teams)
          : !this.hasCaptainSpreadImbalance(teams, numCaptains);
      if (!captainOk) {
        return { teams, valid: false, invalidCount: 1 };
      }
    }

    const teamSizeOk = !this.hasTeamSizeConstraintViolations(teams, constraintParams);
    if (!teamSizeOk) {
      return { teams, valid: false, invalidCount: 1 };
    }

    if (maxGlobalDelta > 0) {
      const stats = this.computeTeamStats(teams, femaleImpactCoef);
      const deltaOk = this.maxGap(stats) <= maxGlobalDelta;
      if (!deltaOk) {
        return { teams, valid: false, invalidCount: 1 };
      }
    }

    return { teams, valid: true, invalidCount: 0 };
  }

  private hasTeamSizeConstraintViolations(
    teams: Player[][],
    params: { playerTeamSizeConstraints: PlayerTeamSizeConstraint[] }
  ): boolean {
    for (const constraint of params.playerTeamSizeConstraints) {
      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        if (!constraint.excludedSizes.includes(team.length)) continue;
        if (team.some((p) => p.id === constraint.playerId)) return true;
      }
    }
    return false;
  }

  /**
   * Valide la répartition des filles entre les équipes.
   *
   * Règles :
   * - Le maximum de filles dans une équipe ne dépasse pas max(ceil(numGirls/numTeams), maxGirlClusterSize).
   * - Quand numGirls >= numTeams ET qu'il n'y a pas de cluster de filles, chaque équipe doit avoir ≥ 1 fille.
   *   (Si un cluster existe, une équipe peut se retrouver sans fille — contrainte inévitable.)
   */
  private isGenderValid(
    teams: Player[][],
    numGirls: number,
    numTeams: number,
    maxGirlClusterSize: number
  ): boolean {
    if (numGirls === 0) return true;
    const counts = teams.map((t) => t.filter((p) => p.gender === 'F').length);
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    const idealMax = Math.max(Math.ceil(numGirls / numTeams), maxGirlClusterSize);
    if (maxCount > idealMax) return false;
    // Sans cluster de filles, chaque équipe doit avoir au moins 1 fille quand numGirls >= numTeams
    if (numGirls >= numTeams && maxGirlClusterSize <= 1 && minCount === 0) return false;
    return true;
  }

  private hasCaptainImbalance(teams: Player[][]): boolean {
    return teams.some((team) => team.filter((p) => p.isCaptain).length > 1);
  }

  private hasCaptainSpreadImbalance(teams: Player[][], numCaptains: number): boolean {
    if (numCaptains < teams.length) return false;
    const counts = teams.map((team) => team.filter((p) => p.isCaptain).length);
    return counts.some((c) => c === 0) || Math.max(...counts) - Math.min(...counts) > 1;
  }

  private weight(p: Player, coef: number): number {
    return p.gender === 'F' ? coef : 1;
  }

  private computeTeamStats(
    teams: Player[][],
    femaleImpactCoef: number
  ): { global: number[]; defense: number[]; attack: number[]; set: number[] } {
    return {
      global: teams.map((t) =>
        t.reduce((s, p) => s + p.global_impact * this.weight(p, femaleImpactCoef), 0) / t.length
      ),
      defense: teams.map((t) =>
        t.reduce((s, p) => s + p.defense * this.weight(p, femaleImpactCoef), 0) / t.length
      ),
      attack: teams.map((t) =>
        t.reduce((s, p) => s + p.attack * this.weight(p, femaleImpactCoef), 0) / t.length
      ),
      set: teams.map((t) =>
        t.reduce((s, p) => s + p.set * this.weight(p, femaleImpactCoef), 0) / t.length
      ),
    };
  }

  private maxGap(stats: {
    global: number[];
    defense: number[];
    attack: number[];
    set: number[];
  }): number {
    const gap = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    return Math.max(
      gap(stats.global),
      gap(stats.defense),
      gap(stats.attack),
      gap(stats.set)
    );
  }

  /**
   * Construit les équipes en plaçant dans l'ordre :
   * 1a. Clusters de filles liées "ensemble" (placées ensemble en priorité sur la répartition de genre)
   * 1b. Filles isolées, réparties greedily (équipe avec le moins de filles en premier)
   * 2.  Capitaines non encore placés
   * 3.  Clusters "ensemble" (fermeture transitive)
   * 4.  Paires "séparés"
   * 5.  Joueurs restants
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

    // 1a. Placer les clusters de filles ensemble (priorité sur la répartition de genre)
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

    // 1b. Répartir les filles isolées (non dans un cluster) de façon équilibrée.
    // Algorithme glouton : chaque fille va dans l'équipe avec le moins de filles actuellement.
    if (numGirls > 0) {
      const clusteredGirlIds = new Set(girlClusters.flat());
      const girls = players.filter((p) => p.gender === 'F');
      const singleGirls = this.shuffle(girls.filter((g) => !clusteredGirlIds.has(g.id)));

      for (const girl of singleGirls) {
        let minGirlCount = Infinity;
        let bestTeam = -1;
        // Parcours dans un ordre aléatoire pour briser les égalités différemment à chaque tentative
        const order = this.shuffle([...Array(numTeams).keys()]);
        for (const t of order) {
          if (freeSlots(t) <= 0) continue;
          const gc = teams[t].filter((p) => p.gender === 'F').length;
          if (gc < minGirlCount) {
            minGirlCount = gc;
            bestTeam = t;
          }
        }
        if (bestTeam === -1) return { teams, valid: false };
        teams[bestTeam].push(girl);
        playerToTeam.set(girl.id, bestTeam);
      }
    }

    // 2. Placer les capitaines non encore placés (une fille peut être capitaine et déjà placée)
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
            const t = teamIndices[i];
            teams[t].push(unplacedCaptains[i]);
            playerToTeam.set(unplacedCaptains[i].id, t);
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

    // 3. Construire les clusters "ensemble" (fermeture transitive)
    const togetherClusters = this.buildTogetherClusters(togetherPairs, playerMap);

    // 4. Placer les clusters ensemble (en évitant les équipes interdites par les paires "séparés")
    for (const cluster of togetherClusters) {
      const placed = cluster.filter((pid) => playerToTeam.has(pid));
      const unplaced = cluster.filter((pid) => !playerToTeam.has(pid));
      if (unplaced.length === 0) {
        // Tous déjà placés — vérifier qu'ils sont dans la même équipe
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
            const other = pair.player1Id === pid ? pair.player2Id : pair.player2Id === pid ? pair.player1Id : null;
            if (other !== null && playerMap.has(other)) {
              const otherTeam = playerToTeam.get(other);
              if (otherTeam !== undefined) forbiddenTeams.add(otherTeam);
            }
          }
        }
        const teamCandidates = [...Array(numTeams).keys()].filter(
          (t) => freeSlots(t) >= cluster.length && !forbiddenTeams.has(t)
        );
        if (teamCandidates.length === 0) return { teams, valid: false };
        teamIdx = teamCandidates[Math.floor(Math.random() * teamCandidates.length)];
      }
      for (const pid of unplaced) {
        const p = playerMap.get(pid);
        if (p) {
          teams[teamIdx].push(p);
          playerToTeam.set(pid, teamIdx);
        }
      }
    }

    // 5. Placer les paires "séparés"
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
        const otherTeams = [...Array(numTeams).keys()].filter((t) => t !== t1 && freeSlots(t) > 0);
        if (otherTeams.length === 0) return { teams, valid: false };
        const teamIdx = otherTeams[Math.floor(Math.random() * otherTeams.length)];
        teams[teamIdx].push(p2);
        playerToTeam.set(pair.player2Id, teamIdx);
      } else if (t2 !== undefined) {
        const otherTeams = [...Array(numTeams).keys()].filter((t) => t !== t2 && freeSlots(t) > 0);
        if (otherTeams.length === 0) return { teams, valid: false };
        const teamIdx = otherTeams[Math.floor(Math.random() * otherTeams.length)];
        teams[teamIdx].push(p1);
        playerToTeam.set(pair.player1Id, teamIdx);
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

    // 6. Remplir les slots restants
    const remaining = this.shuffle(players.filter((p) => !playerToTeam.has(p.id)));
    let idx = 0;
    for (let t = 0; t < numTeams; t++) {
      while (teams[t].length < teamSizes[t]) {
        teams[t].push(remaining[idx++]);
      }
    }

    return { teams, valid: true };
  }

  /** Union-Find pour regrouper les joueurs qui doivent être ensemble. */
  private buildTogetherClusters(
    togetherPairs: PlayerPair[],
    playerMap: Map<number, Player>
  ): number[][] {
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
    const clustersByRoot = new Map<number, number[]>();
    for (const [id] of parent) {
      const root = find(id);
      if (!clustersByRoot.has(root)) clustersByRoot.set(root, []);
      clustersByRoot.get(root)!.push(id);
    }
    return [...clustersByRoot.values()].filter((c) => c.length >= 2);
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
