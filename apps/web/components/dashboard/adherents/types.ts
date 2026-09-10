export interface OptionRef {
  id: string;
  nom: string;
  type?: string;
}

export interface PoliceRef {
  id: string;
  numeroPolice: string;
  statut: string;
  souscripteurId: string;
  produit: { nom: string; version: number } | null;
}

export interface AdherentListe {
  id: string;
  numeroAdherent: string;
  numeroCarte: string;
  nom: string;
  prenom: string;
  sexe: string;
  statut: string;
  souscripteurId: string;
  souscripteur: { id: string; nom: string; type: string } | null;
  police: {
    id: string;
    numeroPolice: string;
    statut: string;
    produit: { nom: string; version: number } | null;
  } | null;
  _count?: { beneficiaires: number };
}

export interface Beneficiaire {
  id: string;
  numeroCarte: string;
  lienParente: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string;
  statut: string;
}

export interface AdherentDetail extends AdherentListe {
  dateNaissance: string;
  ibanOuRib: string | null;
  banqueNom: string | null;
  modePaiementPrefere: string | null;
  createdAt: string;
  beneficiaires: Beneficiaire[];
  police:
    | (AdherentListe['police'] & {
        dateDebut: string | null;
        dateFin: string | null;
      })
    | null;
}
