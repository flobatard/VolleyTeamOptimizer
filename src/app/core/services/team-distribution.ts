/**
 * Calcule la répartition optimale des joueurs en équipes pour une taille cible.
 * Choisit le nombre d'équipes qui minimise l'écart entre la taille réelle et la cible.
 */

function getRoundRobinSizes(numPlayers: number, numTeams: number): number[] {
  const sizes = new Array(numTeams).fill(0);
  for (let i = 0; i < numPlayers; i++) {
    sizes[i % numTeams]++;
  }
  return sizes;
}

/**
 * Retourne le nombre d'équipes optimal pour minimiser l'écart à la taille cible.
 * Ex: 15 joueurs, cible 4 → 4 équipes (3×4 + 1×3)
 * Ex: 18 joueurs, cible 4 → 4 équipes (2×5 + 2×4)
 * Ex: 18 joueurs, cible 6 → 3 équipes (3×6) — ou 6 équipes si cible 3
 */
export function computeOptimalNumTeams(
  numPlayers: number,
  targetTeamSize: number,
  forceEvenTeams?: boolean
): number {
  if (numPlayers <= 0 || targetTeamSize <= 0) return 1;

  const floorTeams = Math.max(1, Math.floor(numPlayers / targetTeamSize));
  const ceilTeams = Math.max(1, Math.ceil(numPlayers / targetTeamSize));

  if (floorTeams === ceilTeams) {
    let numTeams = floorTeams;
    if (forceEvenTeams && numTeams % 2 !== 0) {
      numTeams = numTeams > 1 ? numTeams - 1 : 2;
    }
    return numTeams;
  }

  const floorSizes = getRoundRobinSizes(numPlayers, floorTeams);
  const ceilSizes = getRoundRobinSizes(numPlayers, ceilTeams);

  const floorMaxDev = Math.max(...floorSizes.map((s) => Math.abs(s - targetTeamSize)));
  const ceilMaxDev = Math.max(...ceilSizes.map((s) => Math.abs(s - targetTeamSize)));

  let numTeams = floorMaxDev <= ceilMaxDev ? floorTeams : ceilTeams;

  if (forceEvenTeams && numTeams % 2 !== 0) {
    const alt = numTeams > 1 ? numTeams - 1 : 2;
    const altSizes = getRoundRobinSizes(numPlayers, alt);
    const altMaxDev = Math.max(...altSizes.map((s) => Math.abs(s - targetTeamSize)));
    if (altMaxDev <= floorMaxDev && altMaxDev <= ceilMaxDev) {
      numTeams = alt;
    } else {
      numTeams = numTeams > 1 ? numTeams - 1 : 2;
    }
  }

  return numTeams;
}

export interface TeamDistributionSummary {
  numTeams: number;
  sizes: number[];
  summary: string;
}

/**
 * Calcule et formate le résumé de la répartition des équipes.
 * Ex: "4 équipes dont 3×4 et 1×3"
 */
export function computeTeamDistributionSummary(
  numPlayers: number,
  targetTeamSize: number,
  forceEvenTeams?: boolean
): TeamDistributionSummary {
  const numTeams = computeOptimalNumTeams(numPlayers, targetTeamSize, forceEvenTeams);
  const sizes = getRoundRobinSizes(numPlayers, numTeams);

  const countBySize = new Map<number, number>();
  for (const s of sizes) {
    countBySize.set(s, (countBySize.get(s) ?? 0) + 1);
  }

  const parts = [...countBySize.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, n]) => (n === 1 ? `1×${size}` : `${n}×${size}`));

  const summary =
    numTeams === 1
      ? `1 équipe de ${sizes[0]} joueur${sizes[0] > 1 ? 's' : ''}`
      : `${numTeams} équipes dont ${parts.join(' et ')}`;

  return { numTeams, sizes, summary };
}
