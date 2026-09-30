'use client';

import { CalendarDays, Eye, ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { creerEvenement, modifierEvenement, supprimerEvenement } from '@/app/dashboard-assureur/informatique/evenements/actions';
import {
  CarteResume,
  ChampCheckbox,
  ChampNombre,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

/** Miroir de la sortie de `GET /api/v1/vitrine/evenements`. */
export interface EvenementGestion {
  id: string;
  titre: string;
  description: string | null;
  imageUrl: string;
  dateEvenement: string;
  statut: 'A_VENIR' | 'PASSE';
  ordreAffichage: number;
  actif: boolean;
}

export const LIBELLE_STATUT_EVENEMENT = { A_VENIR: 'À venir', PASSE: 'Passé' };

const dateFr = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Champs communs création / édition (`defaultValue` réappliqués à chaque ouverture). */
function ChampsEvenement({ ev }: { ev?: EvenementGestion }) {
  return (
    <>
      <ChampTexte name="titre" label="Titre" required minLength={2} maxLength={150} defaultValue={ev?.titre} />
      <ChampZone
        name="description"
        label="Description"
        aide="Facultative, 1 000 caractères au plus. Affichée sous le titre dans le carrousel."
        maxLength={1000}
        rows={3}
        defaultValue={ev?.description ?? ''}
      />
      <ChampTexte
        name="image"
        label={ev ? 'Nouvelle image' : 'Image'}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={!ev}
        aide={
          ev
            ? 'Laisser vide pour garder l’image actuelle. JPEG, PNG ou WEBP, 5 Mo au plus.'
            : 'JPEG, PNG ou WEBP, 5 Mo au plus. Format paysage 4:3 conseillé (recadrée au centre).'
        }
      />
      <ChampTexte name="dateEvenement" label="Date de l’événement" type="date" required defaultValue={ev?.dateEvenement} />
      <ChampNombre
        name="ordreAffichage"
        label="Ordre d’affichage"
        aide="0 = en premier. À ordre égal, les événements à venir les plus proches passent devant."
        min={0}
        max={999}
        step={1}
        defaultValue={ev?.ordreAffichage ?? 0}
      />
      <ChampCheckbox name="actif" label="Actif (publié sur la page d’accueil)" defaultChecked={ev?.actif ?? true} />
    </>
  );
}

/**
 * Événements de la page d'accueil (carrousel du bloc « Qui sommes-nous »).
 * Écran réservé à ASSUREUR_INFORMATIQUE ; les 5 premiers événements actifs
 * (ordre d'affichage, puis proximité dans le temps) sont publiés.
 */
export function EvenementsEcran({ evenements }: { evenements: EvenementGestion[] }) {
  const router = useRouter();
  const [edite, setEdite] = useState<EvenementGestion | null>(null);
  const [aSupprimer, setASupprimer] = useState<EvenementGestion | null>(null);

  const actifs = evenements.filter((e) => e.actif);
  const colonnes: ColonneTable<EvenementGestion>[] = [
    {
      cle: 'imageUrl',
      entete: 'Image',
      rendu: (e) => (
        <Image src={e.imageUrl} alt="" width={64} height={48} className="h-12 w-16 rounded-md object-cover" />
      ),
    },
    { cle: 'titre', entete: 'Titre', triable: true, rendu: (e) => <span className="font-medium">{e.titre}</span> },
    { cle: 'dateEvenement', entete: 'Date', triable: true, rendu: (e) => dateFr(e.dateEvenement) },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (e) => (
        <StatutBadge statut={e.statut} ton={e.statut === 'A_VENIR' ? 'info' : 'neutre'} libelles={LIBELLE_STATUT_EVENEMENT} />
      ),
    },
    { cle: 'ordreAffichage', entete: 'Ordre', triable: true, aligneDroite: true },
    {
      cle: 'actif',
      entete: 'Publication',
      valeur: (e) => (e.actif ? 'ACTIF' : 'INACTIF'),
      rendu: (e) =>
        e.actif ? (
          <StatutBadge statut="ACTIF" ton="succes" libelle="Actif" />
        ) : (
          <StatutBadge statut="INACTIF" ton="neutre" libelle="Inactif" />
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Événements" valeur={evenements.length} icon={CalendarDays} />
        <CarteResume libelle="Actifs" valeur={actifs.length} icon={Eye} indice="5 au plus publiés" />
        <CarteResume
          libelle="À venir (actifs)"
          valeur={actifs.filter((e) => e.statut === 'A_VENIR').length}
          icon={ImageIcon}
        />
      </GrilleCartes>

      <DataTable
        donnees={evenements}
        cleLigne={(e) => e.id}
        colonnes={colonnes}
        recherche={{ placeholder: 'Titre…', champs: ['titre'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: [
              { valeur: 'A_VENIR', libelle: 'À venir' },
              { valeur: 'PASSE', libelle: 'Passé' },
            ],
          },
          {
            cle: 'actif',
            libelle: 'Publication',
            options: [
              { valeur: 'ACTIF', libelle: 'Actif' },
              { valeur: 'INACTIF', libelle: 'Inactif' },
            ],
            valeur: (row) => ((row as EvenementGestion).actif ? 'ACTIF' : 'INACTIF'),
          },
        ]}
        actions={
          <FormulaireModal
            titre="Nouvel événement"
            description="L’événement actif apparaît dans le carrousel du bloc « Qui sommes-nous » de la page d’accueil."
            declencheurLabel="Nouvel événement"
            libelleSoumettre="Créer l’événement"
            onSoumettre={creerEvenement}
            onSucces={() => router.refresh()}
          >
            <ChampsEvenement />
          </FormulaireModal>
        }
        actionLigne={(e) => (
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEdite(e)}>
              Modifier
            </Button>
            <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setASupprimer(e)}>
              Supprimer
            </Button>
          </div>
        )}
        vide="Aucun événement pour l’instant. Le bloc « Qui sommes-nous » affiche alors son image habituelle."
      />

      {edite && (
        <FormulaireModal
          key={edite.id}
          titre="Modifier l’événement"
          ouvert
          onOuvertChange={(v) => !v && setEdite(null)}
          onSoumettre={(fd) => modifierEvenement(edite.id, fd)}
          onSucces={() => {
            setEdite(null);
            router.refresh();
          }}
        >
          <ChampsEvenement ev={edite} />
        </FormulaireModal>
      )}

      {aSupprimer && (
        <FormulaireModal
          key={`suppr-${aSupprimer.id}`}
          titre="Supprimer l’événement ?"
          description={`« ${aSupprimer.titre} » sera retiré de la page d’accueil et son image supprimée.`}
          mode="center"
          libelleSoumettre="Supprimer"
          ouvert
          onOuvertChange={(v) => !v && setASupprimer(null)}
          onSoumettre={async () => {
            const r = await supprimerEvenement(aSupprimer.id);
            return r.ok ? { ok: true, message: 'Événement supprimé.' } : r;
          }}
          onSucces={() => {
            setASupprimer(null);
            router.refresh();
          }}
        >
          <p className="text-sm text-muted-foreground">Cette action est définitive.</p>
        </FormulaireModal>
      )}
    </div>
  );
}
