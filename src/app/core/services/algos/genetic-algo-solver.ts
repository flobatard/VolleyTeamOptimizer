import { Player } from "../../models/player";

export class GeneticAlgoSolver {
  // Paramètres de l'algo

  public generateBalancedTeams(players: Player[], targetTeamSize: number, params : any = {}): Player[][] {
    // 0. Default params
    const POPULATION_SIZE = params.POPULATION_SIZE || 100
    const GENERATIONS = params.GENERATIONS || 500
    const MUTATION_RATE = params.MUTATION_RATE || 0.5
    
    // 1. Déterminer le nombre optimal d'équipes
    const numTeams = Math.max(1, Math.round(players.length / targetTeamSize));
    
    // 2. Initialiser la population (des listes de joueurs mélangées au hasard)
    let population: Player[][] = Array.from({ length: POPULATION_SIZE }, () =>
      this.shuffleArray([...players])
    );

    // 3. Boucle d'évolution
    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Trier la population du meilleur au pire (le score le plus bas est le meilleur)
      population.sort((a, b) => this.calculateCost(a, numTeams) - this.calculateCost(b, numTeams));

      const newPopulation: Player[][] = [];
      // On garde les 10% meilleurs (Elitisme) pour ne pas perdre les bonnes solutions
      const eliteCount = Math.max(1, Math.floor(POPULATION_SIZE * 0.05));
      newPopulation.push(...population.slice(0, eliteCount));

      // On remplit le reste
      while (newPopulation.length < POPULATION_SIZE) {
        // Sélection simple : on prend souvent parmi les meilleurs
        const parent = population[Math.floor(Math.random() * (POPULATION_SIZE / 2))];
        
        let child = [...parent];
        
        // Mutation : On échange deux joueurs au hasard
        if (Math.random() < MUTATION_RATE) {
          child = this.mutate(child);
        }
        
        newPopulation.push(child);
      }
      population = newPopulation;
    }

    // A la fin, le meilleur génome est à l'index 0
    population.sort((a, b) => this.calculateCost(a, numTeams) - this.calculateCost(b, numTeams));
    return this.chunkIntoTeams(population[0], numTeams);
  }

  /**
   * LA FONCTION MAGIQUE (Fitness/Cost function)
   * Plus le score retourné est proche de 0, plus les équipes sont équilibrées.
   */
  private calculateCost(genome: Player[], numTeams: number): number {
    const teams = this.chunkIntoTeams(genome, numTeams);
    let totalCost = 0;

    // Calculer la moyenne globale visée par équipe
    const totalGlobal = genome.reduce((sum, p) => sum + p.global_impact, 0);
    const totalDefense = genome.reduce((sum, p) => sum + p.defense, 0)
    const totalSet = genome.reduce((sum, p) => sum + p.set, 0)
    const totalAttack = genome.reduce((sum, p) => sum + p.attack, 0)

    const targetTeamGlobal = totalGlobal / numTeams;
    const targetTeamDefense = totalDefense / numTeams;
    const medianSetter = this.calculateMedian(genome, (player : Player) => player.set)
    const meanSetter = totalSet / genome.length

    const medianAttacker = this.calculateMedian(genome, (player : Player) => player.attack)
    const targetAttackTeam = totalAttack / numTeams

    let max_male = 0
    let max_female = 0
    let min_male = genome.length
    let min_female = genome.length

    for (const team of teams) {
      // 1. Pénalité sur l'écart de niveau Global
      const teamGlobal = team.reduce((sum, p) => sum + p.global_impact, 0);
      const teamDefense = team.reduce((sum, p) => sum + p.defense, 0);
      const teamSetter = team.reduce((max, p) => Math.max(p.set, max), 0)
      const teamAttack = team.reduce((sum, p) => sum + p.attack, 0);
      const bestAttack = team.reduce((max, p) => Math.max(p.attack, max), 0)

      totalCost += Math.abs(targetTeamGlobal - teamGlobal);
      totalCost += Math.abs(targetTeamDefense - teamDefense)

      // 2. Pénalité sur le manque de mixité
      // Si une équipe n'a que des "M" ou que des "F", on pénalise lourdement (poids x50 par exemple)
      const males = team.filter(p => p.gender === 'M').length;
      const females = team.filter(p => p.gender === 'F').length;
      max_male = Math.max(males, max_male)
      max_female = Math.max(females, max_female)
      min_male = Math.min(males, min_male)
      min_female = Math.min(females, min_female)
      if (males === 0 || females === 0) {
        totalCost += 50; 
      }

      // Check setter capability
      if (medianSetter > teamSetter) {
        totalCost += 60
      }
      totalCost += Math.max(0, (meanSetter - teamSetter))*(genome.length/numTeams)
  

       // Check attack capability
      if (medianAttacker > bestAttack) {
        totalCost += 60
      }
      totalCost += Math.abs(targetAttackTeam - teamAttack)
    }

    if (max_female - min_female > 1)
    {
        totalCost += 100*numTeams
    }

    return totalCost;
  }

  // --- Utilitaires ---

  // Découpe le génome plat en X équipes
  private chunkIntoTeams(players: Player[], numTeams: number): Player[][] {
    const teams: Player[][] = Array.from({ length: numTeams }, () => []);
    players.forEach((player, index) => {
      teams[index % numTeams].push(player);
    });
    return teams;
  }

  // Echange deux joueurs au hasard
  private mutate(genome: Player[]): Player[] {
    const idx1 = Math.floor(Math.random() * genome.length);
    const idx2 = Math.floor(Math.random() * genome.length);
    const temp = genome[idx1];
    genome[idx1] = genome[idx2];
    genome[idx2] = temp;
    return genome;
  }

  private calculateMedian(players: Player[], func : Function): number {
    if (players.length === 0) {
      throw new Error("La liste des joueurs est vide.");
    }

    // Extraire les valeurs de l'attribut 'set'
    const sets = players.map(player => func(player));

    // Trier les valeurs
    sets.sort((a, b) => a - b);

    const middleIndex = Math.floor(sets.length / 2);

    // Calculer la médiane
    if (sets.length % 2 === 0) {
      // Si le nombre de joueurs est pair, la médiane est la moyenne des deux valeurs du milieu
      return (sets[middleIndex - 1] + sets[middleIndex]) / 2;
    } else {
      // Si le nombre de joueurs est impair, la médiane est la valeur du milieu
      return sets[middleIndex];
    }
  }


  // Mélange de Fisher-Yates
  private shuffleArray(array: Player[]): Player[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}