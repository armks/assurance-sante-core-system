'use client';

import { FileText, Scale, Wallet } from 'lucide-react';
import Link from 'next/link';

import { Medaillon } from '@/components/dashboard/adherents/medaillon';
import { CarteResume, GrilleCartes, StatutBadge } from '@/components/dashboard/patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_BENEFICIAIRE,
  LIENS_PARENTE,
  TON_STATUT_BENEFICIAIRE,
} from '@/lib/member';
import { LIBELLE_POLICE, TON_POLICE } from '@/lib/police';
import { libelleCategorieActe } from '@/lib/referentiel';

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
  /** Chemin de stockage : lu par la page serveur pour signer, retiré
   * (`sansCheminsPhoto`) avant d'atteindre ce composant client. */
  photoUrl?: string | null;
  beneficiaires?: {
    id: string;
    nom: string;
    prenom: string;
    lienParente: string;
    statut: string;
    photoUrl?: string | null;
  }[];
}

const LIBELLE_LIEN = Object.fromEntries(LIENS_PARENTE.map((l) => [l.valeur, l.libelle]));

export interface ReclamationAdherent {
  id: string;
  typeReclamation: string;
  statut: string;
  montant: string | number;
  createdAt: string;
  remboursement: { plafondRestantApres: string | number | null } | null;
}


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
  photoAdherentUrl = null,
  photosParBeneficiaire = {},
}: {
  adherent: AdherentDetail;
  produit: ProduitAvecGaranties | null;
  reclamations: ReclamationAdherent[];
  /** URLs signées courte durée (`chargerPhotosFamille`). */
  photoAdherentUrl?: string | null;
  photosParBeneficiaire?: Record<string, string | null>;
}) {
  const beneficiaires = adherent.beneficiaires ?? [];
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
                map={TON_POLICE}
                libelles={LIBELLE_POLICE}
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

      <section aria-labelledby="titre-famille" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="titre-famille" className="text-sm font-semibold text-muted-foreground">
            Ma famille
          </h2>
          <Link
            href="/dashboard-adherent/beneficiaires"
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            Gérer les photos et bénéficiaires
          </Link>
        </div>
        <Card>
          <CardContent>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <li className="flex items-center gap-3">
                <Medaillon url={photoAdherentUrl} nom={`${adherent.prenom} ${adherent.nom}`} />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {adherent.prenom} {adherent.nom}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Titulaire · <span className="font-mono">{adherent.numeroCarte}</span>
                  </p>
                </div>
              </li>
              {beneficiaires.map((b) => (
                <li key={b.id} className="flex items-center gap-3">
                  <Medaillon url={photosParBeneficiaire[b.id] ?? null} nom={`${b.prenom} ${b.nom}`} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {b.prenom} {b.nom}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {LIBELLE_LIEN[b.lienParente] ?? b.lienParente}
                      {b.statut !== 'ACTIF' && (
                        <StatutBadge
                          statut={b.statut}
                          map={TON_STATUT_BENEFICIAIRE}
                          libelles={LIBELLE_STATUT_BENEFICIAIRE}
                        />
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {beneficiaires.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">Aucun bénéficiaire rattaché.</p>
            )}
          </CardContent>
        </Card>
      </section>

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
                map={TON_POLICE}
                libelles={LIBELLE_POLICE}
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
                            {libelleCategorieActe(g.categorieActe)}
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
