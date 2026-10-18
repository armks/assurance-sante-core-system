/** Rendez-vous et agenda de présence des médecins (types partagés serveur / client). */
export type StatutRendezVous = 'PROPOSE' | 'CONFIRME' | 'REFUSE' | 'ANNULE';

export const LIBELLE_STATUT_RDV: Record<string, string> = {
  PROPOSE: 'Proposition en attente',
  CONFIRME: 'Confirmé',
  REFUSE: 'Refusé',
  ANNULE: 'Annulé',
};

export interface RendezVous {
  id: string;
  statut: StatutRendezVous;
  dateDebut: string;
  dateFin: string;
  motif: string | null;
  modifie: boolean;
  ancienneDateDebut: string | null;
  motifRefus: string | null;
  patient: { nom: string; numeroCarte: string | null; lien: string };
  etablissement: { id: string; nom: string; adresse: string | null; telephone: string | null };
  medecin: { id: string; nom: string };
  proposePar: string | null;
  /** Présent uniquement pour un rendez-vous confirmé. */
  lienGoogleAgenda: string | null;
}

export interface RegleAgenda {
  id: string;
  medecinId: string;
  medecin: string;
  type: 'DATE' | 'JOUR' | 'ABSENCE';
  date: string | null;
  jourSemaine: number | null;
  valideDu: string | null;
  valideAu: string | null;
  heureDebut: string;
  heureFin: string;
  dureeCreneauMin: number | null;
}

export interface MedecinAgenda {
  id: string;
  nom: string;
}

export interface JourCreneaux {
  date: string;
  creneaux: { debut: string; fin: string }[];
}

export interface PatientRecherche {
  adherentId: string;
  beneficiaireId: string | null;
  nom: string;
  numeroCarte: string | null;
  lien: string;
}

export interface EtablissementRecherche {
  id: string;
  nom: string;
  ville: string | null;
  commune: string | null;
}

export const JOURS_SEMAINE = [
  { valeur: '1', libelle: 'Lundi' },
  { valeur: '2', libelle: 'Mardi' },
  { valeur: '3', libelle: 'Mercredi' },
  { valeur: '4', libelle: 'Jeudi' },
  { valeur: '5', libelle: 'Vendredi' },
  { valeur: '6', libelle: 'Samedi' },
  { valeur: '7', libelle: 'Dimanche' },
];

export const DUREES_CRENEAU = [10, 15, 20, 30, 45, 60, 90, 120];

export const LIBELLE_LIEN: Record<string, string> = { TITULAIRE: 'Titulaire', CONJOINT: 'Conjoint(e)', ENFANT: 'Enfant', PERE: 'Père', MERE: 'Mère', AUTRE: 'Autre' };

// Les heures sont en UTC, qui est l'heure d'Abidjan (GMT) : affichage fixé sur UTC pour ne pas dépendre du fuseau du poste.
const OPTIONS_DATE: Intl.DateTimeFormatOptions = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' };
export const heureRdv = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
export const jourRdv = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', OPTIONS_DATE);
export const jourCourt = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
export const dateHeureRdv = (iso: string) => `${new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })} à ${heureRdv(iso)}`;
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Libellé d'une règle d'agenda (« Tous les lundis, 08:00–12:00, créneaux de 30 min »). */
export function libelleRegle(r: RegleAgenda): string {
  const heures = `${r.heureDebut}–${r.heureFin}`;
  if (r.type === 'ABSENCE') return `Absent le ${new Date(`${r.date}T00:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })}, ${heures}`;
  if (r.type === 'DATE') return `Le ${new Date(`${r.date}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })}, ${heures}, créneaux de ${r.dureeCreneauMin} min`;
  const jour = JOURS_SEMAINE.find((j) => j.valeur === String(r.jourSemaine))?.libelle.toLowerCase() ?? '';
  const periode = r.valideDu || r.valideAu ? ` (${r.valideDu ? `du ${r.valideDu}` : ''}${r.valideAu ? ` au ${r.valideAu}` : ''})` : '';
  return `Tous les ${jour}s, ${heures}, créneaux de ${r.dureeCreneauMin} min${periode}`;
}
