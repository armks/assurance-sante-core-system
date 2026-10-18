/**
 * Licences des sociétés d'assurance : types, durées et calcul de l'état courant. Fonctions pures, partagées par le service de
 * licences, l'identité (`GET /identity/me`) et le contrôle d'accès.
 */
export const TYPES_LICENCE = ['ESSAI', 'MENSUELLE', 'TRIMESTRIELLE', 'SEMESTRIELLE', 'ANNUELLE', 'BIENNALE'] as const;
export type TypeLicence = (typeof TYPES_LICENCE)[number];

/** Durée en mois des licences à échéance (l'essai se compte en jours). */
export const DUREE_MOIS: Record<Exclude<TypeLicence, 'ESSAI'>, number> = {
  MENSUELLE: 1,
  TRIMESTRIELLE: 3,
  SEMESTRIELLE: 6,
  ANNUELLE: 12,
  BIENNALE: 24,
};
export const ESSAI_JOURS = 30;
/** Un code d'activation est valable 24 h : passé ce délai sans activation, il expire. */
export const VALIDITE_CODE_ACTIVATION_MS = 24 * 3_600_000;
/** En dessous de ce nombre de jours restants, l'échéance est signalée (bandeau d'alerte). */
export const SEUIL_ALERTE_JOURS = 30;
/** Profils de l'assureur qui voient la licence et saisissent le code d'activation (les adjoints héritent via la chaîne de rôles). */
export const ROLES_ACTIVATION_LICENCE = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'] as const;

export const LIBELLE_TYPE_LICENCE: Record<TypeLicence, string> = {
  ESSAI: `Licence d’essai (${ESSAI_JOURS} jours)`,
  MENSUELLE: 'Licence mensuelle',
  TRIMESTRIELLE: 'Licence trimestrielle',
  SEMESTRIELLE: 'Licence semestrielle',
  ANNUELLE: 'Licence annuelle',
  BIENNALE: 'Licence de 2 ans',
};

export type EtatAcces = 'ACTIVE' | 'EXPIREE' | 'EN_ATTENTE_ACTIVATION' | 'SUSPENDUE' | 'ABSENTE';

export interface EtatLicence {
  etat: EtatAcces;
  typeLicence: TypeLicence | null;
  plan: string | null;
  /** AAAA-MM-JJ */
  dateDebut: string | null;
  /** AAAA-MM-JJ ; null = sans échéance */
  dateFin: string | null;
  /** jours restants (0 le dernier jour, négatif si échue) ; null si sans échéance */
  joursRestants: number | null;
  /** échéance proche (≤ 30 jours) : alerte à afficher aux administrateurs */
  bientotExpiree: boolean;
}

export interface LicenceBrute {
  typeLicence: string;
  plan: string;
  dateDebut: Date;
  dateFin: Date | null;
  statut: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const minuit = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const JOUR_MS = 86_400_000;

/** État d'accès d'une organisation à partir de sa ligne de licence (null = aucune licence). */
export function calculerEtat(licence: LicenceBrute | null, maintenant: Date = new Date()): EtatLicence {
  if (!licence) {
    return { etat: 'ABSENTE', typeLicence: null, plan: null, dateDebut: null, dateFin: null, joursRestants: null, bientotExpiree: false };
  }
  const joursRestants = licence.dateFin ? Math.round((minuit(licence.dateFin) - minuit(maintenant)) / JOUR_MS) : null;
  let etat: EtatAcces = 'ACTIVE';
  if (licence.statut === 'SUSPENDUE') etat = 'SUSPENDUE';
  else if (licence.statut === 'EN_ATTENTE_ACTIVATION') etat = 'EN_ATTENTE_ACTIVATION';
  else if (licence.statut === 'EXPIREE' || (joursRestants !== null && joursRestants < 0)) etat = 'EXPIREE';
  return {
    etat,
    typeLicence: (TYPES_LICENCE as readonly string[]).includes(licence.typeLicence) ? (licence.typeLicence as TypeLicence) : 'ANNUELLE',
    plan: licence.plan,
    dateDebut: iso(licence.dateDebut),
    dateFin: licence.dateFin ? iso(licence.dateFin) : null,
    joursRestants,
    bientotExpiree: etat === 'ACTIVE' && joursRestants !== null && joursRestants <= SEUIL_ALERTE_JOURS,
  };
}

/** Ajoute des mois calendaires (le 31 janvier + 1 mois = 28/29 février, jamais un débordement sur mars). */
export function ajouterMois(base: Date, mois: number): Date {
  const j = base.getUTCDate();
  const r = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + mois, 1));
  const dernier = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(j, dernier));
  return r;
}

/**
 * Nouvelle période d'une licence. Un renouvellement arrivé AVANT l'échéance prolonge la période en cours (aucun jour perdu) ;
 * après échéance, la période repart d'aujourd'hui. L'essai ne se cumule jamais avec une licence encore valide.
 */
export function calculerPeriode(
  type: TypeLicence,
  courante: { dateFin: Date | null; statut: string } | null,
  maintenant: Date = new Date(),
): { dateDebut: Date; dateFin: Date } {
  const aujourdhui = new Date(minuit(maintenant));
  const encoreValide = !!courante && courante.statut === 'ACTIVE' && courante.dateFin !== null && minuit(courante.dateFin) >= minuit(maintenant);
  if (type === 'ESSAI') {
    return { dateDebut: aujourdhui, dateFin: new Date(aujourdhui.getTime() + ESSAI_JOURS * JOUR_MS) };
  }
  const base = encoreValide ? courante!.dateFin! : aujourdhui;
  return { dateDebut: encoreValide ? aujourdhui : aujourdhui, dateFin: ajouterMois(base, DUREE_MOIS[type]) };
}
