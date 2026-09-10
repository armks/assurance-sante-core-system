'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { validerReclamationManuellement } from '@/app/dashboard-assureur/reclamations-actions';
import {
  ChampNombre,
  ChampSelect,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  LIBELLE_STATUT_RECLAMATION,
  TON_STATUT_RECLAMATION,
  libelleCodeRejet,
  peutTraiterRevue,
  roleRevuePour,
} from '@/lib/reclamations';
import type { Reclamation } from './reclamations-liste';

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

/** Base des liens de détail (diffère selon le dashboard qui monte le composant). */
export function RevueManuelleFile({
  reclamations,
  roleChain,
  baseDetail = '/dashboard-assureur/informatique/reclamations',
}: {
  reclamations: Reclamation[];
  roleChain: string[];
  /** Base des liens « Détail » ; `null` masque le lien (dashboards sans vue détail). */
  baseDetail?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const colonnes: ColonneTable<Reclamation>[] = [
    {
      cle: 'id',
      entete: 'N°',
      rendu: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>,
    },
    { cle: 'typeReclamation', entete: 'Type', triable: true },
    {
      cle: 'montant',
      entete: 'Montant réclamé',
      aligneDroite: true,
      valeur: (r) => Number(r.montant),
      rendu: (r) => montant(r.montant),
    },
    {
      cle: 'rembourse',
      entete: 'Calculé',
      aligneDroite: true,
      valeur: (r) => Number(r.remboursement?.montantRembourse ?? 0),
      rendu: (r) => montant(r.remboursement?.montantRembourse ?? null),
    },
    {
      cle: 'codesRejet',
      entete: 'Motif de mise en revue',
      rendu: (r) =>
        (r.codesRejet ?? []).map((c) => (
          <span key={c} className="block text-xs text-muted-foreground">
            {c} — {libelleCodeRejet(c)}
          </span>
        )),
    },
    {
      cle: 'createdAt',
      entete: 'Reçue le',
      triable: true,
      valeur: (r) => r.createdAt,
      rendu: (r) => dateFr(r.createdAt),
    },
  ];

  return (
    <div className="space-y-4">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <DataTable
        donnees={reclamations}
        cleLigne={(r) => r.id}
        parPage={15}
        recherche={{ placeholder: 'N°, type…', champs: ['id', 'typeReclamation'] }}
        colonnes={colonnes}
        actionLigne={(r) => {
          const autorise = peutTraiterRevue(roleChain, r.typeReclamation);
          return (
            <div className="flex items-center gap-1">
              {baseDetail && (
                <Button asChild size="xs" variant="ghost">
                  <Link href={`${baseDetail}/${r.id}`}>Détail</Link>
                </Button>
              )}
              {autorise ? (
                <FormulaireModal
                  titre="Traiter la réclamation"
                  mode="center"
                  description={`Décision de revue manuelle (réservée à ${roleRevuePour(
                    r.typeReclamation,
                  )}). Montant calculé par l'adjudication : ${montant(
                    r.remboursement?.montantRembourse ?? null,
                  )}.`}
                  declencheur={<Button size="xs">Traiter</Button>}
                  libelleSoumettre="Enregistrer la décision"
                  onSoumettre={async (fd) => {
                    const decision = String(fd.get('decision') ?? '') as
                      | 'APPROUVE'
                      | 'REJETE';
                    const m = fd.get('montantAjuste');
                    const res = await validerReclamationManuellement(r.id, {
                      decision,
                      montantAjuste:
                        decision === 'APPROUVE' && m && m !== ''
                          ? Number(m)
                          : undefined,
                      motif: String(fd.get('motif') ?? ''),
                    });
                    if (!res.ok) return { ok: false, error: res.error, erreurs: [] };
                    return {
                      ok: true,
                      message: `Décision enregistrée → ${
                        LIBELLE_STATUT_RECLAMATION[res.statut] ?? res.statut
                      }.`,
                    };
                  }}
                  onSucces={() => {
                    setMessage('Réclamation traitée.');
                    router.refresh();
                  }}
                >
                  <ChampSelect
                    name="decision"
                    label="Décision"
                    required
                    defaultValue="APPROUVE"
                    options={[
                      { valeur: 'APPROUVE', libelle: 'Approuver le remboursement' },
                      { valeur: 'REJETE', libelle: 'Rejeter la réclamation' },
                    ]}
                  />
                  <ChampNombre
                    name="montantAjuste"
                    label="Montant remboursé ajusté (F)"
                    min={0}
                    step="0.01"
                    aide="Optionnel — ignoré en cas de rejet. Vide = garde le montant calculé."
                  />
                  <ChampZone
                    name="motif"
                    label="Motif de la décision"
                    required
                    rows={3}
                    aide="Tracé dans l'audit (5 caractères minimum)."
                  />
                </FormulaireModal>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  title={`Réservé à ${roleRevuePour(r.typeReclamation)}`}
                >
                  {roleRevuePour(r.typeReclamation) === 'ASSUREUR_MEDECIN_CONSEIL'
                    ? 'revue médecin-conseil'
                    : 'revue exploitation'}
                </span>
              )}
            </div>
          );
        }}
        vide="Aucune réclamation en attente de revue manuelle."
      />

      <p className="text-xs text-muted-foreground">
        Statut cible : <StatutBadge statut="AUTO_ADJUDIQUE" map={TON_STATUT_RECLAMATION} libelles={LIBELLE_STATUT_RECLAMATION} />{' '}
        si approuvée, <StatutBadge statut="REJETE" map={TON_STATUT_RECLAMATION} libelles={LIBELLE_STATUT_RECLAMATION} /> si rejetée.
      </p>
    </div>
  );
}
