'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  changerArchivageSouscripteur,
  creerSouscripteur,
  modifierSouscripteur,
  supprimerSouscripteur,
} from '@/app/dashboard-assureur/informatique/souscripteurs/actions';
import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import { ToutReactiver, type CompteDesactiveResume } from '@/components/dashboard/tout-reactiver';
import {
  CarteResume,
  ConfirmationAction,
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
  /** ACTIF | ARCHIVE (archivage réversible, distinct de la suppression). */
  statut?: 'ACTIF' | 'ARCHIVE';
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
  souscripteurs: tousLesSouscripteurs,
  verdicts = {},
  peutArchiver = false,
  desactives = {},
  peutReactiver = false,
}: {
  souscripteurs: Souscripteur[];
  /** Verdicts « action possible ? » par société (boutons grisés avec la raison). */
  verdicts?: VerdictsListe;
  /** Archivage et suppression : direction et informatique. */
  peutArchiver?: boolean;
  /** Comptes désactivés par l'archivage, par société (boutons « Tout réactiver »). */
  desactives?: Record<string, CompteDesactiveResume[]>;
  peutReactiver?: boolean;
}) {
  const router = useRouter();
  const [voirArchives, setVoirArchives] = useState(false);
  const nbArchives = tousLesSouscripteurs.filter((s) => s.statut === 'ARCHIVE').length;
  const souscripteurs = voirArchives
    ? tousLesSouscripteurs
    : tousLesSouscripteurs.filter((s) => s.statut !== 'ARCHIVE');

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
      cle: 'statut',
      entete: 'Statut',
      rendu: (s) =>
        s.statut === 'ARCHIVE' ? (
          <StatutBadge statut="ARCHIVE" ton="neutre" libelle="Archivée" />
        ) : (
          <StatutBadge statut="ACTIF" ton="succes" libelle="Active" />
        ),
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

      {nbArchives > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
          Archivées ({nbArchives})
        </label>
      )}

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
        actionLigne={(s) => {
          const nom = `la société « ${s.nom} »`;
          const v = verdicts[s.id];
          return (
            <span className="flex flex-wrap justify-end gap-2">
              <Button asChild size="xs" variant="ghost">
                <Link href={`/dashboard-assureur/informatique/souscripteurs/${s.id}`}>Détails</Link>
              </Button>
              <FormulaireModal
                titre="Modifier la société"
                description="Le nom est tracé dans l’audit (ancienne et nouvelle valeur)."
                declencheur={
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={!!v?.modifier && !v.modifier.possible}
                    title={v?.modifier && !v.modifier.possible ? (v.modifier.raison ?? undefined) : undefined}
                  >
                    Modifier
                  </Button>
                }
                libelleSoumettre="Enregistrer"
                onSoumettre={async (fd) => {
                  const effectif = fd.get('effectifDeclare');
                  return modifierSouscripteur(s.id, {
                    nom: String(fd.get('nom') ?? '') || undefined,
                    secteurActivite: String(fd.get('secteurActivite') ?? '') || undefined,
                    effectifDeclare: effectif ? Number(effectif) : undefined,
                    typeCollectivite: String(fd.get('typeCollectivite') ?? '') || undefined,
                  });
                }}
                onSucces={() => router.refresh()}
              >
                <ChampTexte name="nom" label="Nom" required defaultValue={s.nom} />
                {s.type === 'ENTREPRISE' && (
                  <>
                    <ChampTexte name="secteurActivite" label="Secteur d’activité" defaultValue={s.secteurActivite ?? undefined} />
                    <ChampNombre name="effectifDeclare" label="Effectif déclaré" min={1} defaultValue={s.effectifDeclare ?? undefined} />
                  </>
                )}
                {s.type === 'COLLECTIVITE' && (
                  <ChampTexte name="typeCollectivite" label="Type de collectivité" defaultValue={s.typeCollectivite ?? undefined} />
                )}
              </FormulaireModal>
              {s.statut !== 'ARCHIVE' && peutReactiver && (
                <ToutReactiver cible="societe" id={s.id} nom={s.nom} comptes={desactives[s.id] ?? []} />
              )}
              {peutArchiver &&
                (s.statut === 'ARCHIVE' ? (
                  <ConfirmationAction
                    action="desarchiver"
                    element={nom}
                    consequence="Elle redevient active (nouvelles polices et adhérents possibles). Les comptes de la société ne sont PAS réactivés automatiquement."
                    verifier={() => verifierAction('souscripteur', s.id, 'desarchiver')}
                    onConfirmer={() => changerArchivageSouscripteur(s.id, 'desarchiver')}
                    onSucces={() => router.refresh()}
                  />
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={nom}
                    consequence="Plus de nouvelle police ni de nouvel adhérent ; les comptes de la société ne peuvent plus agir. L’historique reste lisible."
                    verifier={() => verifierAction('souscripteur', s.id, 'archiver')}
                    onConfirmer={() => changerArchivageSouscripteur(s.id, 'archiver')}
                    onSucces={() => router.refresh()}
                  />
                ))}
              {peutArchiver && (
                <ConfirmationAction
                  action="supprimer"
                  element={nom}
                  consequence="Suppression logique, tracée, possible uniquement sans aucun lien."
                  verifier={() => verifierAction('souscripteur', s.id, 'supprimer')}
                  onConfirmer={() => supprimerSouscripteur(s.id)}
                  onSucces={() => router.refresh()}
                />
              )}
            </span>
          );
        }}
        vide="Aucun souscripteur pour l’instant."
      />
    </div>
  );
}
