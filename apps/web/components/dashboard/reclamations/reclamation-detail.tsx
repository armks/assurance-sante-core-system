'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { validerReclamationManuellement } from '@/app/dashboard-assureur/reclamations-actions';
import {
  ChampNombre,
  ChampSelect,
  ChampZone,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_RECLAMATION,
  TON_STATUT_RECLAMATION,
  libelleCodeRejet,
  peutTraiterRevue,
} from '@/lib/reclamations';
import type { Reclamation } from './reclamations-liste';
import {
  LIBELLE_STATUT_DOSSIER,
  LIBELLE_STATUT_TICKET,
} from '@/lib/dossier-soins';
import { useCategoriesActe } from '@/components/categories-acte';

interface DossierResume {
  id: string;
  numeroTraitement: string;
  statut: string;
  dateOuverture: string;
  dateCloture: string | null;
  ticket: { id: string; statut: string } | null;
  actes: {
    id: string;
    libelle: string;
    categorieActe: string;
    montantPrescrit: string | null;
  }[];
}

const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function ReclamationDetail({
  reclamation,
  dossier,
  roleChain,
}: {
  reclamation: Reclamation;
  dossier: DossierResume | null;
  roleChain: string[];
}) {
  const { libelle: libelleCategorieActe } = useCategoriesActe();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const r = reclamation.remboursement;
  const enRevue = reclamation.statut === 'REVUE_MANUELLE';
  const autoriseRevue = peutTraiterRevue(roleChain, reclamation.roleRevue);

  return (
    <div className="space-y-6">
      {message && (
        <p className="rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Réclamation</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N°">
            <span className="font-mono text-xs">{reclamation.id}</span>
          </Ligne>
          <Ligne label="Statut">
            <StatutBadge
              statut={reclamation.statut}
              map={TON_STATUT_RECLAMATION}
              libelles={LIBELLE_STATUT_RECLAMATION}
            />
          </Ligne>
          <Ligne label="Type">{reclamation.typeReclamation}</Ligne>
          <Ligne label="Patient">
            {reclamation.beneficiaireId ? 'Bénéficiaire' : 'Adhérent titulaire'}
          </Ligne>
          <Ligne label="Montant réclamé">{montant(reclamation.montant)}</Ligne>
          <Ligne label="Reçue le">{dateFr(reclamation.createdAt)}</Ligne>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Décision de l’adjudication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {r ? (
            <>
              <div className="divide-y">
                <Ligne label="Décision (microservice)">{r.decision}</Ligne>
                <Ligne label="Montant remboursé">
                  {montant(r.montantRembourse)}
                </Ligne>
                <Ligne label="Plafond restant après">
                  {montant(r.plafondRestantApres)}
                </Ligne>
                <Ligne label="Durée de traitement">
                  {r.dureeTraitementMs != null
                    ? `${r.dureeTraitementMs} ms`
                    : '—'}
                </Ligne>
              </div>
              {reclamation.codesRejet && reclamation.codesRejet.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                    Codes de rejet / de mise en revue
                  </p>
                  <ul className="space-y-1 text-sm">
                    {reclamation.codesRejet.map((c) => (
                      <li key={c}>
                        <span className="font-mono">{c}</span> —{' '}
                        {libelleCodeRejet(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            reclamation.codesRejet && reclamation.codesRejet.length > 0 ? (
              // Rejet posé avant adjudication (E011 : catégorie non couverte —
              // aucune garantie, le microservice n'est pas appelé).
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  {LIBELLE_STATUT_RECLAMATION[reclamation.statut] ?? reclamation.statut} sans
                  adjudication — remboursement 0
                </p>
                <ul className="space-y-1 text-sm">
                  {reclamation.codesRejet.map((c) => (
                    <li key={c}>
                      <span className="font-mono">{c}</span> — {libelleCodeRejet(c)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Pas encore d’adjudication (statut {LIBELLE_STATUT_RECLAMATION[reclamation.statut] ?? reclamation.statut}).
              </p>
            )
          )}

          {enRevue && autoriseRevue && (
            <FormulaireModal
              titre="Traiter la réclamation"
              mode="center"
              description={`Décision de revue manuelle (réservée à ${reclamation.roleRevue}).`}
              declencheur={<Button size="sm">Traiter la revue manuelle</Button>}
              libelleSoumettre="Enregistrer la décision"
              onSoumettre={async (fd) => {
                const decision = String(fd.get('decision') ?? '') as
                  | 'APPROUVE'
                  | 'REJETE';
                const m = fd.get('montantAjuste');
                const res = await validerReclamationManuellement(reclamation.id, {
                  decision,
                  montantAjuste:
                    decision === 'APPROUVE' && m && m !== ''
                      ? Number(m)
                      : undefined,
                  motif: String(fd.get('motif') ?? ''),
                });
                if (!res.ok) return { ok: false, error: res.error, erreurs: [] };
                return { ok: true, message: 'Décision enregistrée.' };
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
                aide="Optionnel — ignoré en cas de rejet."
              />
              <ChampZone name="motif" label="Motif" required rows={3} />
            </FormulaireModal>
          )}
          {enRevue && !autoriseRevue && (
            <p className="text-sm text-muted-foreground">
              Revue manuelle réservée à {reclamation.roleRevue}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dossier de soins d’origine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dossier ? (
            <>
              <div className="divide-y">
                <Ligne label="N° de traitement">
                  {dossier.numeroTraitement}
                </Ligne>
                <Ligne label="Statut dossier">
                  <StatutBadge statut={dossier.statut} libelles={LIBELLE_STATUT_DOSSIER} />
                </Ligne>
                <Ligne label="Ticket de soins">
                  {dossier.ticket ? (
                    <StatutBadge
                statut={dossier.ticket.statut}
                libelles={LIBELLE_STATUT_TICKET}
              />
                  ) : (
                    '—'
                  )}
                </Ligne>
                <Ligne label="Ouvert le">
                  {dateFr(dossier.dateOuverture)}
                </Ligne>
              </div>
              {dossier.actes.length > 0 && (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Acte</th>
                        <th className="px-3 py-2 font-medium">Catégorie</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Montant
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dossier.actes.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="px-3 py-2">{a.libelle}</td>
                          <td className="px-3 py-2">
                            {libelleCategorieActe(a.categorieActe)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {montant(a.montantPrescrit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Dossier de soins {reclamation.dossierSoinsId.slice(0, 8)}… non
              accessible.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
