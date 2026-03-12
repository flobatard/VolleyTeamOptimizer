/** Contrainte : un joueur ne peut pas être dans une équipe de taille donnée. */
export interface PlayerTeamSizeConstraint {
  playerId: number;
  excludedSizes: number[];
}
