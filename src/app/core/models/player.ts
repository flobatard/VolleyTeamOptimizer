/** Genres possibles : H (homme), F (femme), A (autre). */
export type Gender = 'H' | 'F' | 'A';

export interface Player {
    id: number,
    name: string,
    attack: number,
    defense: number,
    set: number,
    global_impact: number,
    gender: Gender,
    isCaptain?: boolean
}

/**
 * Normalise une valeur de genre arbitraire (ex. issue d'un CSV) vers un {@link Gender}.
 * Accepte aussi les anciennes valeurs ('M' → 'H'). Toute valeur inconnue retombe sur 'H'.
 */
export function normalizeGender(value: string): Gender {
    const v = value.trim().toUpperCase();
    if (v === 'F') return 'F';
    if (v === 'A') return 'A';
    return 'H'; // 'H', 'M', ou inconnu
}
