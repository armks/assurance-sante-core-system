/**
 * Agenda de présence d'un médecin : règles (date précise, jour de la semaine récurrent, absence) → créneaux de rendez-vous.
 * Fonctions pures. Les dates sont en UTC, qui est l'heure d'Abidjan (GMT, sans changement d'heure).
 */
export interface RegleAgenda {
  type: 'DATE' | 'JOUR' | 'ABSENCE';
  /** AAAA-MM-JJ (DATE, ABSENCE) */
  dateJour: string | null;
  /** 1 = lundi … 7 = dimanche (JOUR) */
  jourSemaine: number | null;
  valideDu: string | null;
  valideAu: string | null;
  /** HH:MM */
  heureDebut: string;
  heureFin: string;
  dureeCreneauMin: number | null;
}

export interface Creneau {
  debut: Date;
  fin: Date;
}

export const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FORMAT_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const instant = (jour: string, min: number) => new Date(Date.parse(`${jour}T00:00:00.000Z`) + min * 60_000);

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'une date AAAA-MM-JJ. */
export function jourSemaineDe(jour: string): number {
  const d = new Date(`${jour}T00:00:00.000Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Date AAAA-MM-JJ de l'instant (UTC). */
export const jourDe = (d: Date): string => d.toISOString().slice(0, 10);

export function ajouterJours(jour: string, n: number): string {
  return jourDe(new Date(Date.parse(`${jour}T00:00:00.000Z`) + n * 86_400_000));
}

/**
 * Créneaux théoriques d'une journée. Si au moins une règle « date précise » existe pour ce jour, elle remplace la règle hebdomadaire ;
 * les absences retirent tout créneau qui les chevauche.
 */
export function creneauxDuJour(jour: string, regles: RegleAgenda[]): Creneau[] {
  const dansValidite = (r: RegleAgenda) => (!r.valideDu || jour >= r.valideDu) && (!r.valideAu || jour <= r.valideAu);
  const parDate = regles.filter((r) => r.type === 'DATE' && r.dateJour === jour);
  const actives = parDate.length > 0 ? parDate : regles.filter((r) => r.type === 'JOUR' && r.jourSemaine === jourSemaineDe(jour) && dansValidite(r));
  const absences = regles.filter((r) => r.type === 'ABSENCE' && r.dateJour === jour).map((r) => [minutes(r.heureDebut), minutes(r.heureFin)] as const);

  const debuts = new Map<number, number>(); // minute de début → durée
  for (const r of actives) {
    const duree = r.dureeCreneauMin ?? 0;
    if (duree <= 0) continue;
    for (let m = minutes(r.heureDebut); m + duree <= minutes(r.heureFin); m += duree) {
      if (!debuts.has(m)) debuts.set(m, duree);
    }
  }
  return [...debuts.entries()]
    .filter(([m, d]) => !absences.some(([a, b]) => m < b && m + d > a))
    .sort((x, y) => x[0] - y[0])
    .map(([m, d]) => ({ debut: instant(jour, m), fin: instant(jour, m + d) }));
}

/** Créneaux libres entre deux dates (incluses) : hors créneaux déjà pris et hors passé. */
export function creneauxLibres(du: string, au: string, regles: RegleAgenda[], occupes: Creneau[], maintenant: Date): { date: string; creneaux: Creneau[] }[] {
  const jours: { date: string; creneaux: Creneau[] }[] = [];
  for (let j = du; j <= au; j = ajouterJours(j, 1)) {
    const libres = creneauxDuJour(j, regles).filter(
      (c) => c.debut.getTime() > maintenant.getTime() && !occupes.some((o) => c.debut < o.fin && c.fin > o.debut),
    );
    if (libres.length > 0) jours.push({ date: j, creneaux: libres });
  }
  return jours;
}

const pad = (n: number) => String(n).padStart(2, '0');
const formatGoogle = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/** Lien « Ajouter à Google Agenda » (modèle d'événement pré-rempli, aucun accès au compte Google). */
export function lienGoogleAgenda(e: { titre: string; debut: Date; fin: Date; details?: string; lieu?: string }): string {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.titre, dates: `${formatGoogle(e.debut)}/${formatGoogle(e.fin)}` });
  if (e.details) p.set('details', e.details);
  if (e.lieu) p.set('location', e.lieu);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
