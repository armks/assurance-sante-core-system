'use client';

import { FileText, Scale, Wallet } from 'lucide-react';

import { CarteResume, GrilleCartes, StatutBadge } from '@/components/dashboard/patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface GarantieAdherent {
  id: string;
  categorieActe: string;
  tauxCouverture: string | number | null;
  plafondParActe: string | number | null;
  plafondAnnuel: string | number | null;
  franchise: string | number | null;
  reseauSoins: string;
}

export interface ProduitAvecGaranties {
  id: string;
  nom: string;
  version: number;
  garanties: GarantieAdherent[];
}

export interface PoliceAdherent {
  id: string;
  numeroPolice: string;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
  produit: { id: string; nom: string; version: number } | null;
}

export interface AdherentDetail {
  id: string;
  nom: string;
  prenom: string;
  numeroAdherent: string;
  numeroCarte: string;
  statut: string;
  police: PoliceAdherent | null;
}

export interface ReclamationAdherent {
  id: string;
  typeReclamation: string;
  statut: string;
  montant: string | number;
  createdAt: string;
  remboursement: { plafondRestantApres: string | number | null } | null;
}

const LIBELLE_STATUT_POLICE: Record<string, string> = {
  DEVIS: 'Devis',
  EN_SOUSCRIPTION: 'En souscription',
  ACTIVE: 'Active',
  SUSPENDUE: 'Suspendue',
  RENOUVELEE: 'Renouvelée',
  RESILIEE: 'Résiliée',
  NON_RENOUVELEE: 'Non renouvelée',
};
const TON_STATUT_POLICE: Record<
  string,
  'succes' | 'attention' | 'danger' | 'neutre'
> = {
  DEVIS: 'attention',
  EN_SOUSCRIPTION: 'attention',
  ACTIVE: 'succes',
  SUSPENDUE: 'danger',
  RENOUVELEE: 'neutre',
  RESILIEE: 'danger',
  NON_RENOUVELEE: 'neutre',
};

const RECLAMATIONS_EN_COURS = ['SOUMISE', 'EN_ADJUDICATION', 'REVUE_MANUELLE'];

const montant = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;
const pourcent = (v: string | number | null) =>
  v === null || v === '' ? '—' : `${Number(v)} %`;
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function AdherentVueEnsemble({
  adherent,
  produit,
  reclamations,
}: {
  adherent: AdherentDetail;
  produit: ProduitAvecGaranties | null;
  reclamations: ReclamationAdherent[];
}) {
  const police = adherent.police;
  const enCours = reclamations.filter((r) => RECLAMATIONS_EN_COURS.includes(r.statut));
  const derniereAvecPlafond = [...reclamations]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .find((r) => r.remboursement?.plafondRestantApres !== null && r.remboursement?.plafondRestantApres !== undefined);

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume
          libelle="Statut de la couverture"
          valeur={
            police ? (
              <StatutBadge
                statut={police.statut}
                map={TON_STATUT_POLICE}
                libelles={LIBELLE_STATUT_POLICE}
              />
            ) : (
              '—'
            )
          }
          icon={FileText}
        />
        <CarteResume
          libelle="Plafond restant (dernière garantie utilisée)"
          valeur={
            derniereAvecPlafond
              ? montant(derniereAvecPlafond.remboursement!.plafondRestantApres)
              : 'Aucune réclamation'
          }
          icon={Wallet}
        />
        <CarteResume
          libelle="Réclamations en cours"
          valeur={enCours.length}
          icon={Scale}
          tonIndice={enCours.length > 0 ? 'neutre' : 'positif'}
        />
      </GrilleCartes>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Votre couverture</h2>
        {!police ? (
          <p className="text-sm text-muted-foreground">
            Aucune police rattachée à votre compte pour l’instant.
          </p>
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">{police.numeroPolice}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {police.produit?.nom ?? produit?.nom ?? '—'}
                  {police.produit?.version ? ` · v${police.produit.version}` : ''} —{' '}
                  {dateFr(police.dateDebut)} → {dateFr(police.dateFin)}
                </p>
              </div>
              <StatutBadge
                statut={police.statut}
                map={TON_STATUT_POLICE}
                libelles={LIBELLE_STATUT_POLICE}
              />
            </CardHeader>
            <CardContent>
              {produit && produit.garanties.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Garantie</th>
                        <th className="px-3 py-2 font-medium text-right">Taux</th>
                        <th className="px-3 py-2 font-medium text-right">Plafond / acte</th>
                        <th className="px-3 py-2 font-medium text-right">Plafond / an</th>
                        <th className="px-3 py-2 font-medium">Réseau</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produit.garanties.map((g) => (
                        <tr key={g.id} className="border-t">
                          <td className="px-3 py-2">
                            {g.categorieActe.replaceAll('_', ' ').toLowerCase()}
                          </td>
                          <td className="px-3 py-2 text-right">{pourcent(g.tauxCouverture)}</td>
                          <td className="px-3 py-2 text-right">{montant(g.plafondParActe)}</td>
                          <td className="px-3 py-2 text-right">{montant(g.plafondAnnuel)}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {g.reseauSoins === 'TOUT_RESEAU' ? 'Tout réseau' : 'Conventionné seul'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Garanties non disponibles.</p>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
