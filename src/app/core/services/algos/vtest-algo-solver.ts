import { Player } from '../../models/player';
import { computeOptimalNumTeams } from '../team-distribution';

export interface VTestParams {
  /** Seuil attaque pour être considéré comme killer (défaut: 7) */
  KILLER_THRESHOLD?: number;
  /** Seuil passe pour être considéré comme passeur (défaut: 7) */
  PASSER_THRESHOLD?: number;
  /** Nombre de tentatives de randomisation pour trouver une solution valide */
  MAX_ATTEMPTS?: number;
  /** Forcer un nombre pair d'équipes */
  FORCE_EVEN_TEAMS?: boolean;
  /** Écart max autorisé entre les moyennes de score global des équipes (défaut: 1). 0 = optimisation maximale. */
  MAX_GLOBAL_DELTA?: number;
  /** Nombre d'équipes à générer (override du calcul automatique) */
  NUM_TEAMS?: number;
}

/**
 * Algorithme simplifié : randomise les équipes en garantissant
 * - au moins 1 killer par équipe (attack >= seuil)
 * - au moins 1 passeur par équipe (set >= seuil)
 * - répartition des filles : si moins de filles que d'équipes, max 1 fille par équipe
 * - équilibrage du score global entre équipes
 */
export class VTestAlgoSolver {
  private static readonly DEFAULT_KILLER_THRESHOLD = 7;
  private static readonly DEFAULT_PASSER_THRESHOLD = 7;
  private static readonly DEFAULT_MAX_ATTEMPTS = 500;
  private static readonly DEFAULT_MAX_GLOBAL_DELTA = 1;

  generateTeams(
    players: Player[],
    targetTeamSize: number,
    params: VTestParams = {},
    onProgress?: (percent: number) => void
  ): Player[][] {
    const killerThreshold = params.KILLER_THRESHOLD ?? VTestAlgoSolver.DEFAULT_KILLER_THRESHOLD;
    const passerThreshold = params.PASSER_THRESHOLD ?? VTestAlgoSolver.DEFAULT_PASSER_THRESHOLD;
    const maxAttempts = params.MAX_ATTEMPTS ?? VTestAlgoSolver.DEFAULT_MAX_ATTEMPTS;
    const forceEvenTeams = params.FORCE_EVEN_TEAMS ?? false;
    const maxGlobalDelta = params.MAX_GLOBAL_DELTA ?? VTestAlgoSolver.DEFAULT_MAX_GLOBAL_DELTA;

    const numTeams = params.NUM_TEAMS ?? computeOptimalNumTeams(players.length, targetTeamSize, forceEvenTeams);

    let bestTeams: Player[][] | null = null;
    let bestInvalidCount = numTeams + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (onProgress && attempt % 10 === 0) {
        onProgress(Math.min(99, Math.round((attempt / maxAttempts) * 100)));
      }

      const result = this.tryRandomAssignment(
        players,
        numTeams,
        killerThreshold,
        passerThreshold
      );

      if (result.valid) {
        if (onProgress) onProgress(100);
        const numGirls = players.filter((p) => p.gender === 'F').length;
        return this.balanceTeamsByGlobalScore(
          result.teams,
          killerThreshold,
          passerThreshold,
          numGirls,
          maxGlobalDelta
        );
      }

      if (result.invalidCount < bestInvalidCount) {
        bestInvalidCount = result.invalidCount;
        bestTeams = result.teams;
      }
    }

    if (onProgress) onProgress(100);
    const numGirls = players.filter((p) => p.gender === 'F').length;
    return this.balanceTeamsByGlobalScore(
      bestTeams!,
      killerThreshold,
      passerThreshold,
      numGirls,
      maxGlobalDelta
    );
  }

  /**
   * Tente une assignation aléatoire et répare les équipes invalides par échanges.
   * Retourne la meilleure répartition trouvée (même partielle si pas assez de killers/passeurs).
   */
  private tryRandomAssignment(
    players: Player[],
    numTeams: number,
    killerThreshold: number,
    passerThreshold: number
  ): { teams: Player[][]; valid: boolean; invalidCount: number } {
    const shuffled = this.shuffle([...players]);
    let teams = this.chunkIntoTeams(shuffled, numTeams);

    const numGirls = players.filter((p) => p.gender === 'F').length;
    const maxRepairIterations = numTeams * 15;

    for (let iter = 0; iter < maxRepairIterations; iter++) {
      // 1. Réparer killer/passer
      const invalidTeamIdx = this.findInvalidTeam(
        teams,
        killerThreshold,
        passerThreshold
      );
      if (invalidTeamIdx >= 0) {
        const repaired = this.tryRepairTeam(
          teams,
          invalidTeamIdx,
          killerThreshold,
          passerThreshold
        );
        if (repaired) {
          teams = repaired;
          continue;
        }
      }

      // 2. Réparer répartition des filles (si moins de filles que d'équipes : max 1 par équipe)
      if (numGirls < numTeams) {
        const genderRepaired = this.tryRepairGender(
          teams,
          killerThreshold,
          passerThreshold
        );
        if (genderRepaired) {
          teams = genderRepaired;
          continue;
        }
      }

      // 3. Réparer répartition des filles (si assez de filles : au moins 1 par équipe)
      if (numGirls >= numTeams) {
        const genderSpreadRepaired = this.tryRepairGenderSpread(
          teams,
          killerThreshold,
          passerThreshold
        );
        if (genderSpreadRepaired) {
          teams = genderSpreadRepaired;
          continue;
        }
      }

      // Plus rien à réparer ou bloqué
      if (
        invalidTeamIdx === -1 &&
        (numGirls < numTeams ? !this.hasGenderImbalance(teams) : !this.hasGenderSpreadImbalance(teams, numGirls))
      ) {
        return { teams, valid: true, invalidCount: 0 };
      }
      if (invalidTeamIdx >= 0) {
        const invalidCount = this.countInvalidTeams(
          teams,
          killerThreshold,
          passerThreshold
        );
        return { teams, valid: false, invalidCount };
      }
    }

    const invalidCount = this.countInvalidTeams(
      teams,
      killerThreshold,
      passerThreshold
    );
    return { teams, valid: invalidCount === 0, invalidCount };
  }

  /** Quand moins de filles que d'équipes : déséquilibre = une équipe a 2+ filles */
  private hasGenderImbalance(teams: Player[][]): boolean {
    return teams.some((team) => team.filter((p) => p.gender === 'F').length > 1);
  }

  /** Quand assez de filles pour toutes les équipes : déséquilibre = une équipe a 0 fille */
  private hasGenderSpreadImbalance(teams: Player[][], numGirls: number): boolean {
    return numGirls >= teams.length && teams.some((team) => team.filter((p) => p.gender === 'F').length === 0);
  }

  /**
   * Quand il y a moins de filles que d'équipes : déplace une fille d'une équipe
   * qui en a 2+ vers une équipe qui en a 0, sans casser killer/passer.
   */
  private tryRepairGender(
    teams: Player[][],
    killerThreshold: number,
    passerThreshold: number
  ): Player[][] | null {
    const numGirls = teams.flat().filter((p) => p.gender === 'F').length;
    if (numGirls >= teams.length) return null;

    for (let fromIdx = 0; fromIdx < teams.length; fromIdx++) {
      const fromTeam = teams[fromIdx];
      const girlsInFrom = fromTeam.filter((p) => p.gender === 'F');
      if (girlsInFrom.length < 2) continue;

      for (let toIdx = 0; toIdx < teams.length; toIdx++) {
        if (toIdx === fromIdx) continue;
        const toTeam = teams[toIdx];
        if (toTeam.some((p) => p.gender === 'F')) continue;

        for (const girl of girlsInFrom) {
          for (let j = 0; j < toTeam.length; j++) {
            const nonGirl = toTeam[j];
            if (nonGirl.gender === 'F') continue;

            const girlIdx = fromTeam.indexOf(girl);
            const newFrom = fromTeam.filter((_, i) => i !== girlIdx);
            newFrom.push(nonGirl);
            const newTo = toTeam.filter((_, i) => i !== j);
            newTo.push(girl);

            const fromStillValid =
              newFrom.some((p) => p.attack >= killerThreshold) &&
              newFrom.some((p) => p.set >= passerThreshold);
            const toStillValid =
              newTo.some((p) => p.attack >= killerThreshold) &&
              newTo.some((p) => p.set >= passerThreshold);

            if (fromStillValid && toStillValid) {
              const newTeams = teams.map((t, idx) => [...t]);
              newTeams[fromIdx] = newFrom;
              newTeams[toIdx] = newTo;
              return newTeams;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Quand il y a assez de filles pour toutes les équipes : déplace une fille d'une équipe
   * qui en a 2+ vers une équipe qui en a 0, sans casser killer/passer.
   */
  private tryRepairGenderSpread(
    teams: Player[][],
    killerThreshold: number,
    passerThreshold: number
  ): Player[][] | null {
    const numGirls = teams.flat().filter((p) => p.gender === 'F').length;
    if (numGirls < teams.length) return null;

    for (let fromIdx = 0; fromIdx < teams.length; fromIdx++) {
      const fromTeam = teams[fromIdx];
      const girlsInFrom = fromTeam.filter((p) => p.gender === 'F');
      if (girlsInFrom.length < 2) continue;

      for (let toIdx = 0; toIdx < teams.length; toIdx++) {
        if (toIdx === fromIdx) continue;
        const toTeam = teams[toIdx];
        if (toTeam.some((p) => p.gender === 'F')) continue;

        for (const girl of girlsInFrom) {
          for (let j = 0; j < toTeam.length; j++) {
            const nonGirl = toTeam[j];
            if (nonGirl.gender === 'F') continue;

            const girlIdx = fromTeam.indexOf(girl);
            const newFrom = fromTeam.filter((_, i) => i !== girlIdx);
            newFrom.push(nonGirl);
            const newTo = toTeam.filter((_, i) => i !== j);
            newTo.push(girl);

            const fromStillValid =
              newFrom.some((p) => p.attack >= killerThreshold) &&
              newFrom.some((p) => p.set >= passerThreshold);
            const toStillValid =
              newTo.some((p) => p.attack >= killerThreshold) &&
              newTo.some((p) => p.set >= passerThreshold);

            if (fromStillValid && toStillValid) {
              const newTeams = teams.map((t, idx) => [...t]);
              newTeams[fromIdx] = newFrom;
              newTeams[toIdx] = newTo;
              return newTeams;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Équilibre les équipes par score global, défense et attaque via échanges,
   * sans casser killer/passer/gender.
   * Arrête quand tous les écarts (global, défense, attaque) <= maxGlobalDelta.
   */
  private balanceTeamsByGlobalScore(
    teams: Player[][],
    killerThreshold: number,
    passerThreshold: number,
    numGirls: number,
    maxGlobalDelta: number
  ): Player[][] {
    const spreadGirls = numGirls < teams.length; // max 1 fille par équipe
    const ensureOneGirlPerTeam = numGirls >= teams.length; // au moins 1 fille par équipe
    let current = teams.map((t) => [...t]);
    const maxIter = teams.length * (teams[0]?.length ?? 0) * 5;

    for (let iter = 0; iter < maxIter; iter++) {
      const stats = this.computeTeamStats(current);
      const cost = this.imbalanceCost(stats);
      if (maxGlobalDelta > 0 && this.maxGap(stats) <= maxGlobalDelta) break;

      let improved = false;

      for (let i = 0; i < current.length && !improved; i++) {
        for (let j = i + 1; j < current.length && !improved; j++) {
          const teamI = current[i];
          const teamJ = current[j];

          for (let ii = 0; ii < teamI.length && !improved; ii++) {
            for (let jj = 0; jj < teamJ.length && !improved; jj++) {
              const pI = teamI[ii];
              const pJ = teamJ[jj];

              const newI = teamI.map((p, idx) => (idx === ii ? pJ : p));
              const newJ = teamJ.map((p, idx) => (idx === jj ? pI : p));

              const newStats = this.computeTeamStats(
                current.map((t, idx) =>
                  idx === i ? newI : idx === j ? newJ : t
                )
              );
              const newCost = this.imbalanceCost(newStats);
              if (newCost >= cost) continue;

              const genderOk = spreadGirls
                ? this.genderValidAfterSwap(current, i, j, pI, pJ)
                : ensureOneGirlPerTeam
                  ? this.genderSpreadValidAfterSwap(current, i, j, pI, pJ)
                  : true;
              if (
                this.teamValid(newI, killerThreshold, passerThreshold) &&
                this.teamValid(newJ, killerThreshold, passerThreshold) &&
                genderOk
              ) {
                current = current.map((t, idx) =>
                  idx === i ? newI : idx === j ? newJ : t
                );
                improved = true;
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    return current;
  }

  private computeTeamStats(
    teams: Player[][]
  ): { global: number[]; defense: number[]; attack: number[] } {
    return {
      global: teams.map((t) =>
        t.reduce((s, p) => s + p.global_impact, 0) / t.length
      ),
      defense: teams.map((t) =>
        t.reduce((s, p) => s + p.defense, 0) / t.length
      ),
      attack: teams.map((t) =>
        t.reduce((s, p) => s + p.attack, 0) / t.length
      ),
    };
  }

  /** Coût d'imbalance : somme des écarts (global + défense + attaque) */
  private imbalanceCost(stats: {
    global: number[];
    defense: number[];
    attack: number[];
  }): number {
    const gap = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    return gap(stats.global) + gap(stats.defense) + gap(stats.attack);
  }

  /** Écart max parmi les trois critères */
  private maxGap(stats: {
    global: number[];
    defense: number[];
    attack: number[];
  }): number {
    const gap = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    return Math.max(
      gap(stats.global),
      gap(stats.defense),
      gap(stats.attack)
    );
  }

  private teamValid(
    team: Player[],
    killerThreshold: number,
    passerThreshold: number
  ): boolean {
    return (
      team.some((p) => p.attack >= killerThreshold) &&
      team.some((p) => p.set >= passerThreshold)
    );
  }

  private genderValidAfterSwap(
    teams: Player[][],
    fromIdx: number,
    toIdx: number,
    pOut: Player,
    pIn: Player
  ): boolean {
    const fromTeam = teams[fromIdx];
    const toTeam = teams[toIdx];
    const fromGirlsAfter =
      fromTeam.filter((p) => p.gender === 'F').length -
      (pOut.gender === 'F' ? 1 : 0) +
      (pIn.gender === 'F' ? 1 : 0);
    const toGirlsAfter =
      toTeam.filter((p) => p.gender === 'F').length -
      (pIn.gender === 'F' ? 1 : 0) +
      (pOut.gender === 'F' ? 1 : 0);
    return fromGirlsAfter <= 1 && toGirlsAfter <= 1;
  }

  /** Vérifie qu'après un swap, chaque équipe garde au moins 1 fille (quand assez de filles). */
  private genderSpreadValidAfterSwap(
    teams: Player[][],
    fromIdx: number,
    toIdx: number,
    pOut: Player,
    pIn: Player
  ): boolean {
    const fromTeam = teams[fromIdx];
    const toTeam = teams[toIdx];
    const fromGirlsAfter =
      fromTeam.filter((p) => p.gender === 'F').length -
      (pOut.gender === 'F' ? 1 : 0) +
      (pIn.gender === 'F' ? 1 : 0);
    const toGirlsAfter =
      toTeam.filter((p) => p.gender === 'F').length -
      (pIn.gender === 'F' ? 1 : 0) +
      (pOut.gender === 'F' ? 1 : 0);
    return fromGirlsAfter >= 1 && toGirlsAfter >= 1;
  }

  private countInvalidTeams(
    teams: Player[][],
    killerThreshold: number,
    passerThreshold: number
  ): number {
    return teams.filter(
      (team) =>
        !team.some((p) => p.attack >= killerThreshold) ||
        !team.some((p) => p.set >= passerThreshold)
    ).length;
  }

  private findInvalidTeam(
    teams: Player[][],
    killerThreshold: number,
    passerThreshold: number
  ): number {
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const hasKiller = team.some((p) => p.attack >= killerThreshold);
      const hasPasser = team.some((p) => p.set >= passerThreshold);
      if (!hasKiller || !hasPasser) return i;
    }
    return -1;
  }

  private tryRepairTeam(
    teams: Player[][],
    invalidIdx: number,
    killerThreshold: number,
    passerThreshold: number
  ): Player[][] | null {
    const invalidTeam = teams[invalidIdx];
    const hasKiller = invalidTeam.some((p) => p.attack >= killerThreshold);
    const hasPasser = invalidTeam.some((p) => p.set >= passerThreshold);

    for (let otherIdx = 0; otherIdx < teams.length; otherIdx++) {
      if (otherIdx === invalidIdx) continue;

      const otherTeam = teams[otherIdx];
      const otherKillers = otherTeam.filter((p) => p.attack >= killerThreshold);
      const otherPassers = otherTeam.filter((p) => p.set >= passerThreshold);

      for (let i = 0; i < invalidTeam.length; i++) {
        for (let j = 0; j < otherTeam.length; j++) {
          const p1 = invalidTeam[i];
          const p2 = otherTeam[j];

          const p1IsKiller = p1.attack >= killerThreshold;
          const p1IsPasser = p1.set >= passerThreshold;
          const p2IsKiller = p2.attack >= killerThreshold;
          const p2IsPasser = p2.set >= passerThreshold;

          const needKiller = !hasKiller;
          const needPasser = !hasPasser;

          const wouldGainKiller = needKiller && p2IsKiller && !p1IsKiller;
          const wouldGainPasser = needPasser && p2IsPasser && !p1IsPasser;

          const otherKillersAfter =
            otherKillers.length - (p2IsKiller ? 1 : 0) + (p1IsKiller ? 1 : 0);
          const otherPassersAfter =
            otherPassers.length - (p2IsPasser ? 1 : 0) + (p1IsPasser ? 1 : 0);
          const otherStillValid =
            otherKillersAfter >= 1 && otherPassersAfter >= 1;

          const swapMakesSense =
            (wouldGainKiller || wouldGainPasser) && otherStillValid;

          if (swapMakesSense) {
            const newTeams = teams.map((t, idx) => [...t]);
            newTeams[invalidIdx][i] = p2;
            newTeams[otherIdx][j] = p1;
            return newTeams;
          }
        }
      }
    }

    return null;
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
