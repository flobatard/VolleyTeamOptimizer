import { Player } from "../../models/player";

export class GeneticAlgoSolver {
  // Paramètres de l'algo
  private POPULATION_SIZE = 100;
  private GENERATIONS = 500;
  private MUTATION_RATE = 0.2;

  public generateBalancedTeams(players: Player[], targetTeamSize: number): Player[][] {
    // 1. Déterminer le nombre optimal d'équipes
    const numTeams = Math.max(1, Math.round(players.length / targetTeamSize));
    
    // 2. Initialiser la population (des listes de joueurs mélangées au hasard)
    let population: Player[][] = Array.from({ length: this.POPULATION_SIZE }, () =>
      this.shuffleArray([...players])
    );

    // 3. Boucle d'évolution
    for (let gen = 0; gen < this.GENERATIONS; gen++) {
      // Trier la population du meilleur au pire (le score le plus bas est le meilleur)
      population.sort((a, b) => this.calculateCost(a, numTeams) - this.calculateCost(b, numTeams));

      const newPopulation: Player[][] = [];
      // On garde les 10% meilleurs (Elitisme) pour ne pas perdre les bonnes solutions
      const eliteCount = Math.floor(this.POPULATION_SIZE * 0.1);
      newPopulation.push(...population.slice(0, eliteCount));

      // On remplit le reste
      while (newPopulation.length < this.POPULATION_SIZE) {
        // Sélection simple : on prend souvent parmi les meilleurs
        const parent = population[Math.floor(Math.random() * (this.POPULATION_SIZE / 2))];
        
        let child = [...parent];
        
        // Mutation : On échange deux joueurs au hasard
        if (Math.random() < this.MUTATION_RATE) {
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
    const targetTeamGlobal = totalGlobal / numTeams;

    for (const team of teams) {
      // 1. Pénalité sur l'écart de niveau Global
      const teamGlobal = team.reduce((sum, p) => sum + p.global_impact, 0);
      totalCost += Math.abs(targetTeamGlobal - teamGlobal);

      // 2. Pénalité sur le manque de mixité
      // Si une équipe n'a que des "M" ou que des "F", on pénalise lourdement (poids x50 par exemple)
      const males = team.filter(p => p.gender === 'M').length;
      const females = team.filter(p => p.gender === 'F').length;
      if (males === 0 || females === 0) {
        totalCost += 50; 
      }

      // Vous pouvez ajouter d'autres pénalités ici :
      // - Si la somme de la défense est trop basse...
      // - S'il n'y a pas de "setters" (joueurs avec une stat 'set' élevée)...
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

  // Mélange de Fisher-Yates
  private shuffleArray(array: Player[]): Player[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}