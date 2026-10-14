'use client';

import { CalendarClock, ClipboardList, Pill, Stethoscope } from 'lucide-react';
import { useState } from 'react';

import { StatutBadge } from '@/components/dashboard/patterns';
import { cn } from '@/lib/utils';
import { LIBELLE_STATUT_ORDONNANCE } from '@/lib/dossier-soins';

export interface LigneOrdonnanceDossier {
  id: string;
  denominationMedicament: string;
  dosage: string | null;
  posologie: string;
  duree: string | null;
  quantitePrescrite: number;
  statut: string;
}

export interface OrdonnanceDossier {
  id: string;
  consultationId: string;
  medecinId: string;
  statut: string;
  datePrescription: string;
  dateValidite: string;
  lignesOrdonnance: LigneOrdonnanceDossier[];
}

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const heureFr = (d: string) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « Paracetamol (ARCET 500MG CPR B/20) » → dénomination commune + nom commercial. */
function separerMedicament(libelle: string): { dci: string; commercial: string | null } {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(libelle);
  return m ? { dci: m[1].trim(), commercial: m[2].trim() } : { dci: libelle, commercial: null };
}

function joursRestants(dateValidite: string): number {
  return Math.ceil((new Date(dateValidite).getTime() - Date.now()) / 86_400_000);
}

/**
 * Ordonnances d'un dossier de soins : la liste des ordonnances en tableau, en haut ; la ligne choisie affiche dessous
 * sa prescription — la liste de ses médicaments en tableau (médicament, posologie, durée, quantité, délivrance).
 */
export function OrdonnancesDossier({
  ordonnances,
  numeroConsultation,
  nomMedecin,
}: {
  ordonnances: OrdonnanceDossier[];
  /** N° de la consultation d'une ordonnance. */
  numeroConsultation: (consultationId: string) => string | null;
  nomMedecin: (id: string) => string;
}) {
  // la plus récente d'abord
  const liste = [...ordonnances].sort((a, b) => b.datePrescription.localeCompare(a.datePrescription));
  const [choisieId, setChoisieId] = useState<string | null>(liste[0]?.id ?? null);

  if (liste.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        <ClipboardList aria-hidden="true" className="size-6" />
        Aucune ordonnance émise dans ce dossier.
      </div>
    );
  }

  const choisie = liste.find((o) => o.id === choisieId) ?? liste[0];
  const restants = joursRestants(choisie.dateValidite);

  return (
    <div className="space-y-2">
      {/* --- Liste des ordonnances (tableau) : cliquer une ligne affiche sa prescription en dessous --- */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Liste des ordonnances — choisissez une ligne pour afficher sa prescription</caption>
          <thead>
            <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Ordonnance</th>
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Consultation</th>
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Prescrite par</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">Médicaments</th>
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Valable jusqu’au</th>
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {liste.map((o) => {
              const actif = o.id === choisie.id;
              return (
                <tr
                  key={o.id}
                  onClick={() => setChoisieId(o.id)}
                  aria-selected={actif}
                  className={cn('cursor-pointer transition-colors hover:bg-accent/50', actif && 'bg-primary/5 shadow-[inset_3px_0_0_0] shadow-primary')}
                >
                  <td className="whitespace-nowrap px-3 py-1">
                    <button
                      type="button"
                      onClick={() => setChoisieId(o.id)}
                      aria-pressed={actif}
                      className="text-left font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {dateFr(o.datePrescription)}
                      <span className="ml-1.5 font-normal text-muted-foreground">{heureFr(o.datePrescription)}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1 font-mono text-xs text-muted-foreground">{numeroConsultation(o.consultationId) ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1">{nomMedecin(o.medecinId)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{o.lignesOrdonnance.length}</td>
                  <td className="whitespace-nowrap px-3 py-1">{dateFr(o.dateValidite)}</td>
                  <td className="whitespace-nowrap px-3 py-1">
                    <StatutBadge statut={o.statut} libelles={LIBELLE_STATUT_ORDONNANCE} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* --- Prescription sélectionnée --- */}
      <section className="rounded-lg border" aria-label="Prescription sélectionnée">
        <header className="space-y-1 border-b bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Pill aria-hidden="true" className="size-4 text-primary" />
              Prescription — {choisie.lignesOrdonnance.length} médicament{choisie.lignesOrdonnance.length > 1 ? 's' : ''}
            </h3>
            <StatutBadge statut={choisie.statut} libelles={LIBELLE_STATUT_ORDONNANCE} />
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="flex items-center gap-1.5">
              <Stethoscope aria-hidden="true" className="size-3.5" />
              <dt className="sr-only">Prescrite par</dt>
              <dd className="text-foreground">{nomMedecin(choisie.medecinId)}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              <dt className="sr-only">Émise le</dt>
              <dd className="text-foreground">
                {dateFr(choisie.datePrescription)} à {heureFr(choisie.datePrescription)}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Valable jusqu’au</dt>
              <dd className="text-foreground">
                {dateFr(choisie.dateValidite)}
                {choisie.statut === 'ACTIVE' && restants > 0 && <span className="text-muted-foreground"> ({restants} j)</span>}
              </dd>
            </div>
          </dl>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-8 whitespace-nowrap px-3 py-1.5 font-medium">#</th>
                <th className="whitespace-nowrap px-3 py-1.5 font-medium">Médicament</th>
                <th className="whitespace-nowrap px-3 py-1.5 font-medium">Posologie</th>
                <th className="whitespace-nowrap px-3 py-1.5 font-medium">Durée</th>
                <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">Qté</th>
                <th className="whitespace-nowrap px-3 py-1.5 font-medium">Délivrance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {choisie.lignesOrdonnance.map((l, i) => {
                const { dci, commercial } = separerMedicament(l.denominationMedicament);
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-1 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-1">
                      <span className="font-medium">{dci}</span>
                      {(commercial || l.dosage) && (
                        <span className="text-xs text-muted-foreground">
                          {' · '}
                          {commercial}
                          {commercial && l.dosage ? ' · ' : ''}
                          {l.dosage}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1">{l.posologie}</td>
                    <td className="whitespace-nowrap px-3 py-1">{l.duree ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-1 text-right font-medium tabular-nums">{l.quantitePrescrite}</td>
                    <td className="whitespace-nowrap px-3 py-1">
                      <StatutBadge
                        statut={l.statut}
                        map={{ DISPONIBLE: 'neutre', SERVIE: 'succes' }}
                        libelles={{ DISPONIBLE: 'À délivrer', SERVIE: 'Servi' }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
