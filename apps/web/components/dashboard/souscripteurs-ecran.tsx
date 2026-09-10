'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { creerSouscripteur } from '@/app/dashboard-assureur/informatique/souscripteurs/actions';
import {
  CarteResume,
  ChampCheckbox,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Building2, Landmark, User } from 'lucide-react';

export interface Souscripteur {
  id: string;
  type: 'ENTREPRISE' | 'COLLECTIVITE' | 'INDIVIDUEL';
  nom: string;
  secteurActivite: string | null;
  effectifDeclare: number | null;
  typeCollectivite: string | null;
  createdAt: string;
}

const LIBELLE_TYPE: Record<string, string> = {
  ENTREPRISE: 'Entreprise',
  COLLECTIVITE: 'Collectivité',
  INDIVIDUEL: 'Individuel',
};

/** Champs du formulaire adaptés dynamiquement au type choisi. */
function ChampsSouscripteur() {
  const [type, setType] = useState<string>('ENTREPRISE');
  const [subvention, setSubvention] = useState(false);

  return (
    <>
      <ChampSelect
        name="type"
        label="Type"
        required
        value={type}
        onChange={(e) => setType(e.target.value)}
        options={[
          { valeur: 'ENTREPRISE', libelle: 'Entreprise' },
          { valeur: 'COLLECTIVITE', libelle: 'Collectivité' },
          { valeur: 'INDIVIDUEL', libelle: 'Individuel' },
        ]}
      />
      <ChampTexte name="nom" label="Nom" required placeholder="Raison sociale ou nom" />

      {type === 'ENTREPRISE' && (
        <>
          <ChampTexte
            name="secteurActivite"
            label="Secteur d’activité"
            placeholder="BTP, Agroalimentaire…"
          />
          <ChampNombre name="effectifDeclare" label="Effectif déclaré" min={1} />
        </>
      )}

      {type === 'COLLECTIVITE' && (
        <>
          <ChampTexte
            name="typeCollectivite"
            label="Type de collectivité"
            placeholder="Mutuelle communautaire, Coopérative…"
          />
          <ChampTexte
            name="organeGouvernance"
            label="Organe de gouvernance"
            placeholder="Comité de gestion, Assemblée générale…"
          />
          <ChampCheckbox
            name="subventionExterne"
            label="Bénéficie d’une subvention externe"
            checked={subvention}
            onChange={(e) => setSubvention(e.target.checked)}
          />
          {subvention && (
            <ChampTexte
              name="bailleurSubvention"
              label="Bailleur / source de la subvention"
            />
          )}
        </>
      )}

      {type === 'INDIVIDUEL' && (
        <ChampTexte
          name="numeroPieceIdentite"
          label="Numéro de pièce d’identité"
        />
      )}
    </>
  );
}

export function SouscripteursEcran({
  souscripteurs,
}: {
  souscripteurs: Souscripteur[];
}) {
  const router = useRouter();

  const parType = (t: string) =>
    souscripteurs.filter((s) => s.type === t).length;

  const colonnes: ColonneTable<Souscripteur>[] = [
    { cle: 'nom', entete: 'Nom', triable: true },
    {
      cle: 'type',
      entete: 'Type',
      rendu: (s) => (
        <StatutBadge statut={s.type} ton="info" libelle={LIBELLE_TYPE[s.type]} />
      ),
    },
    {
      cle: 'detail',
      entete: 'Détail',
      rendu: (s) =>
        s.type === 'ENTREPRISE'
          ? [s.secteurActivite, s.effectifDeclare && `${s.effectifDeclare} pers.`]
              .filter(Boolean)
              .join(' · ') || '—'
          : s.type === 'COLLECTIVITE'
            ? s.typeCollectivite || '—'
            : '—',
    },
    {
      cle: 'createdAt',
      entete: 'Créé le',
      triable: true,
      valeur: (s) => s.createdAt,
      rendu: (s) => new Date(s.createdAt).toLocaleDateString('fr-FR'),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume
          libelle="Souscripteurs"
          valeur={souscripteurs.length}
          icon={Building2}
        />
        <CarteResume
          libelle="Entreprises"
          valeur={parType('ENTREPRISE')}
          icon={Building2}
        />
        <CarteResume
          libelle="Collectivités"
          valeur={parType('COLLECTIVITE')}
          icon={Landmark}
        />
        <CarteResume
          libelle="Individuels"
          valeur={parType('INDIVIDUEL')}
          icon={User}
        />
      </GrilleCartes>

      <DataTable
        donnees={souscripteurs}
        cleLigne={(s) => s.id}
        parPage={10}
        recherche={{
          placeholder: 'Nom, secteur…',
          champs: ['nom', 'secteurActivite', 'typeCollectivite'],
        }}
        filtres={[
          {
            cle: 'type',
            libelle: 'Type',
            options: [
              { valeur: 'ENTREPRISE', libelle: 'Entreprise' },
              { valeur: 'COLLECTIVITE', libelle: 'Collectivité' },
              { valeur: 'INDIVIDUEL', libelle: 'Individuel' },
            ],
          },
        ]}
        colonnes={colonnes}
        actions={
          <FormulaireModal
            titre="Nouveau souscripteur"
            description="Entreprise, collectivité ou souscripteur individuel affilié."
            declencheurLabel="Nouveau souscripteur"
            libelleSoumettre="Créer le souscripteur"
            onSoumettre={async (fd) => {
              const type = String(fd.get('type') ?? '');
              const effectif = fd.get('effectifDeclare');
              return creerSouscripteur({
                type,
                nom: String(fd.get('nom') ?? ''),
                secteurActivite: String(fd.get('secteurActivite') ?? '') || undefined,
                effectifDeclare: effectif ? Number(effectif) : undefined,
                typeCollectivite:
                  String(fd.get('typeCollectivite') ?? '') || undefined,
                organeGouvernance:
                  String(fd.get('organeGouvernance') ?? '') || undefined,
                subventionExterne: fd.get('subventionExterne') === 'on',
                bailleurSubvention:
                  String(fd.get('bailleurSubvention') ?? '') || undefined,
                numeroPieceIdentite:
                  String(fd.get('numeroPieceIdentite') ?? '') || undefined,
              });
            }}
            onSucces={() => router.refresh()}
          >
            <ChampsSouscripteur />
          </FormulaireModal>
        }
        actionLigne={(s) => (
          <Button asChild size="xs" variant="ghost">
            <Link
              href={`/dashboard-assureur/informatique/souscripteurs/${s.id}`}
            >
              Détails
            </Link>
          </Button>
        )}
        vide="Aucun souscripteur pour l’instant."
      />
    </div>
  );
}
