import { Player } from "../../models/player";
import { PlayerPair } from "../../models/player-pair";

export interface GAParams {
  POPULATION_SIZE?: number;
  GENERATIONS?: number;
  MUTATION_RATE?: number;
  FORCE_EVEN_TEAMS?: boolean;

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

  public generateBalancedTeams(players: Player[], targetTeamSize: number, params: GAParams = {}): Player[][] {
    const POPULATION_SIZE = params.POPULATION_SIZE || 200;
    const GENERATIONS = params.GENERATIONS || 1000;
    const MUTATION_RATE = params.MUTATION_RATE || 0.7;
    const FORCE_EVEN_TEAMS = params.FORCE_EVEN_TEAMS || false;

    // 1. Déterminer le nombre optimal d'équipes
    let numTeams = Math.max(1, Math.round(players.length / targetTeamSize));
    if (FORCE_EVEN_TEAMS && numTeams % 2 !== 0) {
      numTeams = (players.length / numTeams > targetTeamSize) ? 
                 (numTeams > 1 ? numTeams + 1 : 2) : 
                 (numTeams > 1 ? numTeams - 1 : 2);
    }

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
    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Le tri est maintenant ultra rapide car le 'totalCost' est déjà calculé !
      population.sort((a, b) => a.totalCost - b.totalCost);

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
    return this.chunkIntoTeams(population[0].genome, numTeams);
  }

  // --- Fonctions d'évaluation ---

  private preCalculateConstants(players: Player[], numTeams: number, params: GAParams = {}): GameConstants {
    const totalGlobal = players.reduce((sum, p) => sum + p.global_impact, 0);
    const totalDefense = players.reduce((sum, p) => sum + p.defense, 0);
    const totalSet = players.reduce((sum, p) => sum + p.set, 0);
    const totalAttack = players.reduce((sum, p) => sum + p.attack, 0);
    const medianAttacker = this.calculateMedian(players, (p: Player) => p.attack);
    const medianSetter = this.calculateMedian(players, (p: Player) => p.set);

    return {
      targetMeanGlobal: totalGlobal / players.length,
      targetTeamDefense: totalDefense / numTeams,
      medianSetter,
      meanSetter: totalSet / players.length,
      medianAttacker,
      targetMeanAttack: totalAttack / players.length,
      attackerThreshold: params.ATTACKER_THRESHOLD ?? medianAttacker,
      attackersPerTeam: params.ATTACKERS_PER_TEAM ?? 1,
      attackAbsencePenalty: params.ATTACK_ABSENCE_PENALTY ?? 50,
      setterThreshold: params.SETTER_THRESHOLD ?? medianSetter,
      setterAbsencePenalty: params.SETTER_ABSENCE_PENALTY ?? 300,
      globalMeanPenaltyFactor: params.GLOBAL_MEAN_PENALTY_FACTOR ?? 1.5,
      teamDefensePenaltyFactor: params.TEAM_DEFENSE_PENALTY_FACTOR ?? 1,
      togetherPairs: params.TOGETHER_PAIRS ?? [],
      apartPairs: params.APART_PAIRS ?? [],
      pairConstraintPenalty: params.PAIR_CONSTRAINT_PENALTY ?? 1000,
    };
  }

  private calculateCost(genome: Player[], numTeams: number, constants: GameConstants): {totalCost: number, teamsCost: {team: Player[], cost: number}[]} {
    const teams = this.chunkIntoTeams(genome, numTeams);
    let totalCost = 0;

    let max_female = 0, min_female = genome.length;

    let teamsCost : {team: Player[], cost: number}[] = []; 

    // --- 2. Évaluation des équipes ---
    for (const team of teams) {
      let teamCost = 0;
      
      const teamMeanGlobal = team.reduce((sum, p) => sum + p.global_impact, 0) / team.length;
      const teamDefense = team.reduce((sum, p) => sum + p.defense, 0);
      const teamSetter = team.reduce((max, p) => Math.max(p.set, max), 0);
      const teamAttack = team.reduce((sum, p) => sum + p.attack, 0);
      const bestAttack = team.reduce((max, p) => Math.max(p.attack, max), 0);

      const attackersInTeam = team.filter(p => p.attack >= constants.attackerThreshold).length;
      const settersInTeam = team.filter(p => p.set >= constants.setterThreshold).length;
      const setterOrAttackeInTeam = team.filter(p => p.set >= constants.setterThreshold || p.attack >= constants.attackerThreshold).length;

      // To prevent if someone is both setter and attacker to have seperate roles
      if (setterOrAttackeInTeam < 1 + constants.attackersPerTeam) teamCost += constants.attackAbsencePenalty;

      // Utilisation du carré (Math.pow) pour lisser les écarts et pénaliser plus durement les gros déséquilibres
      teamCost += Math.pow(teamMeanGlobal - constants.targetMeanGlobal, 2) * (genome.length / numTeams) * constants.globalMeanPenaltyFactor;
      teamCost += Math.pow(constants.targetTeamDefense - teamDefense, 2) * constants.teamDefensePenaltyFactor;

      // Passeur
      if (constants.setterThreshold >= teamSetter) teamCost += constants.setterAbsencePenalty;
      teamCost += Math.max(0, (constants.meanSetter - teamSetter)) * (genome.length / numTeams);

      // Attaquant
      if (constants.attackerThreshold > bestAttack) teamCost += constants.attackAbsencePenalty;
      if (attackersInTeam < constants.attackersPerTeam) teamCost += constants.attackAbsencePenalty * (constants.attackersPerTeam - attackersInTeam);
      teamCost += Math.pow(constants.targetMeanAttack - teamAttack, 2) * (genome.length / numTeams);

      // Mixité
      const females = team.filter(p => p.gender === 'F').length;
      max_female = Math.max(females, max_female);
      min_female = Math.min(females, min_female);

      totalCost += teamCost;
      teamsCost.push({team: team, cost: teamCost})
    }

    if (max_female - min_female > 1) {
      totalCost += 100 * numTeams;
    }

    // Contraintes soft sur les paires de joueurs
    if (constants.togetherPairs.length > 0 || constants.apartPairs.length > 0) {
      const playerTeamIndex = new Map<number, number>();
      teams.forEach((team, idx) => team.forEach(p => playerTeamIndex.set(p.id, idx)));

      for (const pair of constants.togetherPairs) {
        const t1 = playerTeamIndex.get(pair.player1Id);
        const t2 = playerTeamIndex.get(pair.player2Id);
        if (t1 !== undefined && t2 !== undefined && t1 !== t2) {
          totalCost += constants.pairConstraintPenalty;
        }
      }

      for (const pair of constants.apartPairs) {
        const t1 = playerTeamIndex.get(pair.player1Id);
        const t2 = playerTeamIndex.get(pair.player2Id);
        if (t1 !== undefined && t2 !== undefined && t1 === t2) {
          totalCost += constants.pairConstraintPenalty;
        }
      }
    }

    return {totalCost: totalCost, teamsCost: teamsCost};
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

  private calculateMedian(players: Player[], func: (p: Player) => number): number {
    if (players.length === 0) throw new Error("La liste des joueurs est vide.");
    const values = players.map(player => func(player)).sort((a, b) => a - b);
    const middle = values.length % 2 === 0 ? Math.round(values.length / 2) : Math.floor(values.length / 2);
    return values.length % 2 === 0 ? (values[middle] + values[middle + 1]) / 2 : values[middle];
  }

  private shuffleArray(array: Player[]): Player[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}