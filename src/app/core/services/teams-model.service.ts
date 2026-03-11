import { Player } from "../models/player";

export interface EstimatedTeam {
    team: Player[],
    value: number,
    details: {
        global: number,
        attack: number,
        defense: number,
        setter: number
    }
}

export function estimateTeamQuality(team: Player[], attackersPTeam: number | undefined, attackerThreshold: number, setterThreshold: number): EstimatedTeam {
  if (team.length === 0) {
    return { team, value: 0, details: { global: 0, attack: 0, defense: 0, setter: 0 } };
  }

  const attackersPerTeam  = attackersPTeam ?? 1;

  // --- Global impact : moyenne normalisée sur 100 ---
  const globalScore = (team.reduce((s, p) => s + p.global_impact, 0) / team.length) * 10;

  // --- Défense : moyenne normalisée ---
  const defenseScore = (team.reduce((s, p) => s + p.defense, 0) / team.length) * 10;

  // --- Attaque : moyenne + pénalité si rôle non couvert ---
  const meanAttack    = team.reduce((s, p) => s + p.attack, 0) / team.length;
  const attackersCount = team.filter(p => p.attack >= attackerThreshold).length;
  let attackScore = meanAttack / 10 * 100;
  if (attackersCount < attackersPerTeam) {
    attackScore *= 0.6 + 0.4 * (attackersCount / attackersPerTeam); // pénalité proportionnelle au manque
  }

  // --- Passe : meilleur passeur + pénalité si absent ---
  const bestSet  = Math.max(...team.map(p => p.set));
  const hasSetter = bestSet >= setterThreshold;
  let setterScore = bestSet / 10 * 100;
  if (!hasSetter) setterScore *= 0.5;

  // --- Score global pondéré ---
  const value = Math.round(
    globalScore  * 0.40 +
    defenseScore * 0.20 +
    attackScore  * 0.20 +
    setterScore  * 0.20
  );

  return {
    team,
    value: Math.max(0, Math.min(100, value)),
    details: {
      global:  Math.round(globalScore),
      attack:  Math.round(attackScore),
      defense: Math.round(defenseScore),
      setter:  Math.round(setterScore),
    }
  };
}