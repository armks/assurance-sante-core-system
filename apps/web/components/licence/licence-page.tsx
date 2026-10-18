import { CalendarClock, CalendarDays, CalendarRange, KeyRound, ShieldCheck, Tag } from 'lucide-react';

import { FormulaireActivation } from '@/components/licence/formulaire-activation';
import { Alerte, CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { apiFetch, messageErreur } from '@/lib/api';

interface Statut {
  etat: 'ACTIVE' | 'EXPIREE' | 'EN_ATTENTE_ACTIVATION' | 'SUSPENDUE' | 'ABSENTE';
  typeLicence: string | null;
  libelleType: string | null;
  plan: string | null;
  dateDebut: string | null;
  dateFin: string | null;
  joursRestants: number | null;
  bientotExpiree: boolean;
  peutActiver: boolean;
  codeEnAttente: { typeLicence: string; expireLe: string } | null;
}

const dateFr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const LIBELLE_ETAT: Record<Statut['etat'], string> = {
  ACTIVE: 'Active',
  EXPIREE: 'Expirée',
  EN_ATTENTE_ACTIVATION: 'En attente d’activation',
  SUSPENDUE: 'Suspendue',
  ABSENTE: 'Aucune licence',
};

/** Durée restante lisible : « 3 mois et 12 jours », « 12 jours », « dernier jour »… */
function tempsRestant(jours: number | null): string {
  if (jours === null) return 'Sans échéance';
  if (jours < 0) return `Expirée depuis ${-jours} jour${-jours > 1 ? 's' : ''}`;
  if (jours === 0) return 'Dernier jour';
  const mois = Math.floor(jours / 30);
  const reste = jours % 30;
  if (mois === 0) return `${jours} jour${jours > 1 ? 's' : ''}`;
  return `${mois} mois${reste ? ` et ${reste} jour${reste > 1 ? 's' : ''}` : ''}`;
}

/**
 * Licence de la société : type, dates de début et de fin, temps restant avant le renouvellement et, pour l'informatique et la
 * direction de l'assureur, formulaire de renouvellement par code d'activation temporaire.
 */
export async function LicencePage() {
  const res = await apiFetch('/api/v1/licences/statut');
  if (!res.ok) return <p className="text-sm text-destructive">{await messageErreur(res)}</p>;
  const l = (await res.json()) as Statut;
  const pctEcoule =
    l.dateDebut && l.dateFin
      ? Math.min(100, Math.max(0, Math.round(((Date.now() - Date.parse(l.dateDebut)) / (Date.parse(l.dateFin) - Date.parse(l.dateDebut) || 1)) * 100)))
      : 0;
  const critique = l.joursRestants !== null && l.joursRestants <= 7;
  return (
    <div className="space-y-8">
      {l.etat === 'ACTIVE' && l.bientotExpiree && (
        <Alerte ton={critique ? 'erreur' : 'avertissement'} annonce="aucune" titre={critique ? 'Votre licence expire très bientôt' : 'Votre licence arrive à échéance'}>
          Elle expire le {dateFr(l.dateFin)} ({tempsRestant(l.joursRestants)}). Demandez un code d’activation au support pour la renouveler sans interruption : le renouvellement anticipé prolonge la période en cours, aucun jour n’est perdu.
        </Alerte>
      )}
      {l.etat !== 'ACTIVE' && (
        <Alerte ton="erreur" annonce="aucune" titre={`Licence : ${LIBELLE_ETAT[l.etat].toLowerCase()}`}>
          L’accès de votre société est suspendu tant que la licence n’est pas réactivée.
        </Alerte>
      )}

      <GrilleCartes>
        <CarteResume libelle="Type de licence" valeur={l.libelleType ?? '—'} icon={Tag} indice={l.plan ? `Formule ${l.plan}` : undefined} />
        <CarteResume libelle="État" valeur={LIBELLE_ETAT[l.etat]} icon={ShieldCheck} tonIndice={l.etat === 'ACTIVE' ? 'positif' : 'negatif'} />
        <CarteResume libelle="Début" valeur={dateFr(l.dateDebut)} icon={CalendarDays} />
        <CarteResume libelle="Expiration" valeur={dateFr(l.dateFin)} icon={CalendarRange} />
      </GrilleCartes>

      <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Temps restant">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
            <CalendarClock className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Temps restant avant le renouvellement</p>
            <p className="text-2xl font-semibold tabular-nums">{tempsRestant(l.joursRestants)}</p>
          </div>
        </div>
        {l.dateFin && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctEcoule} aria-label="Part de la période de licence écoulée">
              <div className={critique ? 'h-full bg-destructive' : l.bientotExpiree ? 'h-full bg-amber-500' : 'h-full bg-primary'} style={{ width: `${pctEcoule}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{pctEcoule} % de la période écoulée</p>
          </div>
        )}
      </section>

      {l.peutActiver && (
        <section className="max-w-xl space-y-3 rounded-xl border bg-card p-5" aria-label="Renouvellement">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4" aria-hidden="true" /> Renouveler ou prolonger la licence
          </h2>
          {l.codeEnAttente && (
            <p className="text-xs text-muted-foreground">
              Un code d’activation a été émis pour vous ; il expire le {new Date(l.codeEnAttente.expireLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
            </p>
          )}
          <FormulaireActivation libelleBouton="Renouveler" />
        </section>
      )}
    </div>
  );
}
