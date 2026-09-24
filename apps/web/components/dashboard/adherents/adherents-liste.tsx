'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

import { creerAdherent } from '@/app/dashboard-assureur/adherents-actions';
import {
  CarteResume,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import {
  LIBELLE_STATUT_MEMBRE,
  STATUTS_MEMBRE,
  TON_STATUT_MEMBRE,
} from '@/lib/member';
import { ChampsNouvelAdherent } from './champs-nouvel-adherent';
import type { AdherentListe, OptionRef, PoliceRef } from './types';

export function AdherentsListe({
  adherents,
  souscripteurs,
  polices,
  peutCreer,
  basePath,
  souscripteurVerrou,
}: {
  adherents: AdherentListe[];
  souscripteurs: OptionRef[];
  polices: PoliceRef[];
  peutCreer: boolean;
  basePath: string;
  souscripteurVerrou?: string;
}) {
  const router = useRouter();
  const parStatut = (s: string) => adherents.filter((a) => a.statut === s).length;

  const colonnes: ColonneTable<AdherentListe>[] = [
    { cle: 'numeroAdherent', entete: 'N° adhérent', triable: true },
    {
      cle: 'nom',
      entete: 'Nom / prénom',
      triable: true,
      valeur: (a) => `${a.nom} ${a.prenom}`,
      rendu: (a) => (
        <span className="font-medium">{`${a.nom} ${a.prenom}`}</span>
      ),
    },
    {
      cle: 'souscripteur',
      entete: 'Souscripteur / police',
      valeur: (a) => a.souscripteur?.nom ?? '',
      rendu: (a) => (
        <div className="text-sm">
          <span>{a.souscripteur?.nom ?? '—'}</span>
          {a.police && (
            <span className="block text-xs text-muted-foreground">
              {a.police.numeroPolice}
              {a.police.produit ? ` · ${a.police.produit.nom}` : ''}
            </span>
          )}
        </div>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => (
        <StatutBadge
          statut={a.statut}
          map={TON_STATUT_MEMBRE}
          libelles={LIBELLE_STATUT_MEMBRE}
        />
      ),
    },
    {
      cle: 'numeroCarte',
      entete: 'N° carte',
      rendu: (a) => <span className="font-mono text-xs">{a.numeroCarte}</span>,
    },
    {
      cle: 'beneficiaires',
      entete: 'Bénéf.',
      aligneDroite: true,
      valeur: (a) => a._count?.beneficiaires ?? 0,
      rendu: (a) => a._count?.beneficiaires ?? 0,
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Adhérents" valeur={adherents.length} icon={Users} />
        <CarteResume libelle="Actifs" valeur={parStatut('ACTIF')} />
        <CarteResume libelle="Suspendus" valeur={parStatut('SUSPENDU')} />
        <CarteResume libelle="Radiés" valeur={parStatut('RADIE')} />
      </GrilleCartes>

      <DataTable
        donnees={adherents}
        cleLigne={(a) => a.id}
        parPage={15}
        recherche={{
          placeholder: 'Nom, prénom, n° adhérent, formule…',
          champs: ['nom', 'prenom', 'numeroAdherent', 'souscripteur.nom', 'police.produit.nom'],
        }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: STATUTS_MEMBRE.map((s) => ({
              valeur: s,
              libelle: LIBELLE_STATUT_MEMBRE[s],
            })),
          },
          {
            cle: 'formule',
            libelle: 'Formule',
            valeur: (row) => (row as AdherentListe).police?.produit?.nom ?? null,
            options: Array.from(
              new Set(
                adherents
                  .map((a) => a.police?.produit?.nom)
                  .filter((nom): nom is string => Boolean(nom)),
              ),
            ).map((nom) => ({ valeur: nom, libelle: nom })),
          },
        ]}
        colonnes={colonnes}
        actions={
          peutCreer ? (
            <FormulaireModal
              titre="Nouvel adhérent"
              description="L’adhérent est créé ACTIF ; ses numéros d’adhérent et de carte sont générés automatiquement."
              declencheurLabel="Nouvel adhérent"
              libelleSoumettre="Créer l’adhérent"
              onSoumettre={async (fd) =>
                creerAdherent({
                  souscripteurId: String(fd.get('souscripteurId') ?? ''),
                  policeId: String(fd.get('policeId') ?? '') || undefined,
                  nom: String(fd.get('nom') ?? ''),
                  prenom: String(fd.get('prenom') ?? ''),
                  dateNaissance: String(fd.get('dateNaissance') ?? ''),
                  sexe: String(fd.get('sexe') ?? ''),
                  modePaiementPrefere:
                    String(fd.get('modePaiementPrefere') ?? '') || undefined,
                })
              }
              onSucces={() => router.refresh()}
            >
              <ChampsNouvelAdherent
                souscripteurs={souscripteurs}
                polices={polices}
                souscripteurVerrou={souscripteurVerrou}
              />
            </FormulaireModal>
          ) : undefined
        }
        actionLigne={(a) => (
          <Button asChild size="xs" variant="ghost">
            <Link href={`${basePath}/${a.id}`}>Détails</Link>
          </Button>
        )}
        vide="Aucun adhérent pour l’instant."
      />
    </div>
  );
}
