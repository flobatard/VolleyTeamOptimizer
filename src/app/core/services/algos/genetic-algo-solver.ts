import { Player } from "../../models/player";
import { PlayerPair } from "../../models/player-pair";
import { EstimatedTeam, estimateTeamQuality } from "../teams-model.service";
import { computeOptimalNumTeams } from "../team-distribution";

export interface GAParams {
  POPULATION_SIZE?: number;
  GENERATIONS?: number;
  MUTATION_RATE?: number;
  FORCE_EVEN_TEAMS?: boolean;
  /** Nombre d'équipes à générer (override du calcul automatique) */
  NUM_TEAMS?: number;

  // Attaque
  ATTACKER_THRESHOLD?: number;
  ATTACKERS_PER_TEAM?: number;
  ATTACK_ABSENCE_PENALTY?: number;

  // Passe
  SETTER_THRESHOLD?: number;
  SETTER_ABSENCE_PENALTY?: number;

  // Généraux
  GLOBAL_MEAN_PENALTY_FACTOR?: number;
  TEAM_DEFENSE_PENALTY_FACTOR?: number;

  // Contraintes paires
  TOGETHER_PAIRS?: PlayerPair[];
  APART_PAIRS?: PlayerPair[];
  PAIR_CONSTRAINT_PENALTY?: number;
}

// Interface pour mettre en cache le score (Schwartzian transform)
interface EvaluatedGenome {
  genome: Player[];
  totalCost: number;
  teamsCost: {team: Player[], cost: number}[];
}

// Interface pour regrouper nos constantes mathématiques
interface GameConstants {
  targetMeanGlobal: number;
  targetTeamDefense: number;
  medianSetter: number;
  meanSetter: number;
  medianAttacker: number;
  targetMeanAttack: number;
  attackerThreshold: number;
  attackersPerTeam: number;
  attackAbsencePenalty: number;
  setterThreshold: number;
  setterAbsencePenalty: number;
  globalMeanPenaltyFactor: number;
  teamDefensePenaltyFactor: number;
  togetherPairs: PlayerPair[];
  apartPairs: PlayerPair[];
  pairConstraintPenalty: number;
}

export class GeneticAlgoSolver {

  public generateBalancedTeams(players: Player[], targetTeamSize: number, params: GAParams = {}, onProgress?: (percent: number) => void): { teams: Player[][], convergence: { generation: number, bestCost: number }[] } {
    const POPULATION_SIZE = params.POPULATION_SIZE || 200;
    const GENERATIONS = params.GENERATIONS || 1000;
    const MUTATION_RATE = params.MUTATION_RATE || 0.7;
    const FORCE_EVEN_TEAMS = params.FORCE_EVEN_TEAMS || false;

    // 1. Déterminer le nombre d'équipes (override utilisateur ou calcul automatique)
    let numTeams = params.NUM_TEAMS ?? computeOptimalNumTeams(players.length, targetTeamSize, FORCE_EVEN_TEAMS);

    // 2. PRE-CALCUL DES CONSTANTES (Le gros gain de performance est ici)
    const constants = this.preCalculateConstants(players, numTeams, params);

    // 3. Initialiser la population ET l'évaluer immédiatement (Mise en cache du score)
    let population: EvaluatedGenome[] = Array.from({ length: POPULATION_SIZE }, () => {
      const genome = this.shuffleArray([...players]);
      const {totalCost, teamsCost} = this.calculateCost(genome, numTeams, constants)
      return {
        genome: genome,
        totalCost: totalCost,
        teamsCost: teamsCost
      };
    });

    // 4. Boucle d'évolution
    const convergence: { generation: number, bestCost: number }[] = [];
    const reportInterval = Math.max(1, Math.floor(GENERATIONS / 20));
    for (let gen = 0; gen < GENERATIONS; gen++) {
      if (onProgress && gen % reportInterval === 0) {
        onProgress(Math.round((gen / GENERATIONS) * 100));
      }
      // Le tri est maintenant ultra rapide car le 'totalCost' est déjà calculé !
      population.sort((a, b) => a.totalCost - b.totalCost);
      convergence.push({ generation: gen, bestCost: population[0].totalCost });

      const newPopulation: EvaluatedGenome[] = [];
      
      // Elitisme : On garde les 10% meilleurs
      const eliteCount = Math.max(1, Math.floor(POPULATION_SIZE * 0.10));
      newPopulation.push(...population.slice(0, eliteCount));

      // On remplit le reste
      while (newPopulation.length < POPULATION_SIZE) {
        // Sélection simple dans le top 50%
        const parent = population[Math.floor(Math.random() * (POPULATION_SIZE / 2))].genome;
        
        let child = [...parent];
        
        // Mutation
        if (Math.random() < MUTATION_RATE) {
          child = this.mutate(child);
        }
        
        const {totalCost, teamsCost} = this.calculateCost(child, numTeams, constants)

        // On évalue l'enfant une seule fois à sa naissance
        newPopulation.push({
          genome: child,
          totalCost: totalCost,
          teamsCost: teamsCost
        });
      }
      population = newPopulation;
    }

    // A la fin, on trie une dernière fois pour être sûr d'avoir le meilleur à l'index 0
    population.sort((a, b) => a.totalCost - b.totalCost);
    return { teams: this.chunkIntoTeams(population[0].genome, numTeams), convergence: convergence };
  }

  // --- Fonctions d'évaluation ---

  private preCalculateConstants(players: Player[], numTeams: number, params: GAParams = {}): GameConstants {
    const totalGlobal = players.reduce((sum, p) => sum + p.global_impact, 0);
    const totalDefense = players.reduce((sum, p) => sum + p.defense, 0);
    const totalSet = players.reduce((sum, p) => sum + p.set, 0);
    const totalAttack = players.reduce((sum, p) => sum + p.attack, 0);
    const medianAttacker = calculatePlayerMedian(players, (p: Player) => p.attack);
    const medianSetter = calculatePlayerMedian(players, (p: Player) => p.set);

    return {
      targetMeanGlobal: totalGlobal / players.length,
      targetTeamDefense: totalDefense / numTeams,
      medianSetter,
      meanSetter: totalSet / players.length,
      medianAttacker,
      targetMeanAttack: totalAttack / numTeams,
      attackerThreshold: params.ATTACKER_THRESHOLD ?? medianAttacker,
      attackersPerTeam: params.ATTACKERS_PER_TEAM ?? 1,
      attackAbsencePenalty: params.ATTACK_ABSENCE_PENALTY ?? 50,
      setterThreshold: params.SETTER_THRESHOLD ?? medianSetter + 0.5,
      setterAbsencePenalty: params.SETTER_ABSENCE_PENALTY ?? 300,
      globalMeanPenaltyFactor: params.GLOBAL_MEAN_PENALTY_FACTOR ?? 1.5,
      teamDefensePenaltyFactor: params.TEAM_DEFENSE_PENALTY_FACTOR ?? 1,
      togetherPairs: params.TOGETHER_PAIRS ?? [],
      apartPairs: params.APART_PAIRS ?? [],
      pairConstraintPenalty: params.PAIR_CONSTRAINT_PENALTY ?? 1000,
    };
  }

  private calculateCost(genome: Player[], numTeams: number, constants: GameConstants): {totalCost: number, detailCost: {gender: number, teamQualities: number, pairPenalities: number}, teamsCost: {team: Player[], cost: number}[], detailsTeamsCost: {team: Player[], global: number, defense: number, set: number, attack: number, attackDetails: {abscencePenalty: number, meanPenalty: number}}[]} {
    const teams = this.chunkIntoTeams(genome, numTeams);
    let totalCost = 0;
    const detailCost : {gender: number, teamQualities: number, pairPenalities: number} = {gender: 0, teamQualities: 0, pairPenalities: 0}

    let max_female = 0, min_female = genome.length;
    let max_male_other = 0, min_male_other = genome.length

    let teamsCost : {team: Player[], cost: number}[] = []; 
    let detailsTeamsCost : {team: Player[], global: number, defense: number, set: number, attack: number, attackDetails: {abscencePenalty: number, meanPenalty: number}}[] = []

    // --- 2. Évaluation des équipes ---
    for (const team of teams) {
      let detailTeamCost = {team: team, global: 0, defense: 0, set: 0, attack: 0, attackDetails: {abscencePenalty: 0, meanPenalty: 0}}
      let teamCost = 0;
      
      const teamMeanGlobal = team.reduce((sum, p) => sum + p.global_impact, 0) / team.length;
      const teamDefense = team.reduce((sum, p) => sum + p.defense, 0);
      const teamSetter = team.reduce((max, p) => Math.max(p.set, max), 0);
      const teamAttack = team.reduce((sum, p) => sum + p.attack, 0);
      const bestAttack = team.reduce((max, p) => Math.max(p.attack, max), 0);

      const attackersInTeam = team.filter(p => p.attack >= constants.attackerThreshold).length;
      const settersInTeam = team.filter(p => p.set >= constants.setterThreshold).length;
      const setterOrAttackeInTeam = team.filter(p => p.set >= constants.setterThreshold || p.attack >= constants.attackerThreshold).length;

      // Utilisation du carré (Math.pow) pour lisser les écarts et pénaliser plus durement les gros déséquilibres
      const globalCost = Math.pow(teamMeanGlobal - constants.targetMeanGlobal, 2) * (genome.length / numTeams) * constants.globalMeanPenaltyFactor;
      
      const defenseCost = Math.pow(constants.targetTeamDefense - teamDefense, 2) * constants.teamDefensePenaltyFactor;

      teamCost += globalCost
      teamCost += defenseCost

      let setterCost = 0

      // Passeur
      if (constants.setterThreshold > teamSetter) setterCost += constants.setterAbsencePenalty;
      setterCost += Math.max(0, (constants.meanSetter - teamSetter)) * (genome.length / numTeams);

      teamCost += setterCost

      let attackCost = 0

      // Attaquant
      let abscenceAttackPenalty = 0
      // To prevent if someone is both setter and attacker to have seperate roles
      if (setterOrAttackeInTeam < 1 + constants.attackersPerTeam && settersInTeam > 0) abscenceAttackPenalty += constants.attackAbsencePenalty;

      if (constants.attackerThreshold > bestAttack) abscenceAttackPenalty += constants.attackAbsencePenalty;
      if (attackersInTeam < constants.attackersPerTeam) abscenceAttackPenalty += constants.attackAbsencePenalty * (constants.attackersPerTeam - attackersInTeam);
      const meanAttackPenalty = Math.pow(constants.targetMeanAttack - teamAttack, 2) * (genome.length / numTeams);
      attackCost = meanAttackPenalty + abscenceAttackPenalty
      const attackDetailsCost : {abscencePenalty: number, meanPenalty: number} = {abscencePenalty: abscenceAttackPenalty, meanPenalty: meanAttackPenalty}
      teamCost += attackCost

      detailTeamCost.attack = attackCost
      detailTeamCost.set = setterCost
      detailTeamCost.defense = defenseCost
      detailTeamCost.global = globalCost
      detailTeamCost.attackDetails = attackDetailsCost

      // Mixité
      const females = team.filter(p => p.gender === 'F').length;
      const males_others = team.filter(p => p.gender === 'M' || p.gender  === "A").length
      max_female = Math.max(females, max_female);
      min_female = Math.min(females, min_female);
      max_male_other = Math.max(males_others, max_male_other)
      min_male_other = Math.min(males_others, min_male_other)

      totalCost += teamCost;
      teamsCost.push({team: team, cost: teamCost})
      detailsTeamsCost.push(detailTeamCost)
    }

    const teamsQualities = []
    for (const team of teams) {
      const estimatedTeam = estimateTeamQuality(team, constants.attackersPerTeam, constants.attackerThreshold, constants.setterThreshold)
      teamsQualities.push(estimatedTeam)
    }

    const varianceTeamQuality = calculateEstimatedTeamVariance(teamsQualities, (team) => team.value)
    detailCost.teamQualities = varianceTeamQuality
    
    totalCost += varianceTeamQuality

    if (max_female - min_female > 1) {
      totalCost += 100 * numTeams;
      detailCost.gender = 100 * numTeams
    }

    if (max_male_other - min_male_other > 1) {
      totalCost += 100 * numTeams;
      detailCost.gender = 100 * numTeams
    }

    let pairPenalities = 0;
    // Contraintes soft sur les paires de joueurs
    if (constants.togetherPairs.length > 0 || constants.apartPairs.length > 0) {
      const playerTeamIndex = new Map<number, number>();
      teams.forEach((team, idx) => team.forEach(p => playerTeamIndex.set(p.id, idx)));

      for (const pair of constants.togetherPairs) {
        const t1 = playerTeamIndex.get(pair.player1Id);
        const t2 = playerTeamIndex.get(pair.player2Id);
        if (t1 !== undefined && t2 !== undefined && t1 !== t2) {
          pairPenalities += constants.pairConstraintPenalty;
          totalCost += constants.pairConstraintPenalty;
        }
      }

      for (const pair of constants.apartPairs) {
        const t1 = playerTeamIndex.get(pair.player1Id);
        const t2 = playerTeamIndex.get(pair.player2Id);
        if (t1 !== undefined && t2 !== undefined && t1 === t2) {
          pairPenalities += constants.pairConstraintPenalty;
          totalCost += constants.pairConstraintPenalty;
        }
      }
    }

    return {totalCost: totalCost, detailCost: detailCost, teamsCost: teamsCost, detailsTeamsCost: detailsTeamsCost};
  }

  // --- Utilitaires ---
  private chunkIntoTeams(players: Player[], numTeams: number): Player[][] {
    const teams: Player[][] = Array.from({ length: numTeams }, () => []);
    players.forEach((player, index) => {
      teams[index % numTeams].push(player);
    });
    return teams;
  }

  private mutate(genome: Player[]): Player[] {
    const idx1 = Math.floor(Math.random() * genome.length);
    const idx2 = Math.floor(Math.random() * genome.length);
    const temp = genome[idx1];
    genome[idx1] = genome[idx2];
    genome[idx2] = temp;
    return genome;
  }



  private shuffleArray(array: Player[]): Player[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export function calculatePlayerMedian(players: Player[], func: (p: Player) => number): number {
  if (players.length === 0) throw new Error("La liste des joueurs est vide.");
  const values = players.map(player => func(player)).sort((a, b) => a - b);
  const middle = values.length % 2 === 0 ? Math.round(values.length / 2) : Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle] + values[middle - 1]) / 2 : values[middle];
}


export function calculateEstimatedTeamVariance(teams: EstimatedTeam[], func: (team : EstimatedTeam) => number) : number {
  const values = teams.map(team => func(team))
  const mean =(values.reduce((sum, p) => sum + p))/values.length
  const squaredDiffs = values.map(v => (v - mean)**2)

  const variance : number = squaredDiffs.reduce((sum, diff) => sum + diff) / squaredDiffs.length

  return variance
}