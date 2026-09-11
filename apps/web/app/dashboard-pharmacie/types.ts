export interface LigneOrdonnance {
  medicament: string;
  dosage?: string;
  posologie: string;
  duree?: string;
  quantite?: number;
}

export interface CodeOrdonnancePharmacie {
  id: string;
  code: string;
  statut: string;
  dateEmission: string;
  dateExpiration: string;
  ordonnance: {
    id: string;
    statut: string;
    numeroTraitement: string;
    lignes: LigneOrdonnance[];
  } | null;
}
