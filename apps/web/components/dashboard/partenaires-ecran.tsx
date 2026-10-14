'use client';

import { ExternalLink, Eye, Handshake } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ajouterPartenaire,
  changerVisibilitePartenaire,
  modifierPartenaire,
  supprimerPartenaire,
} from '@/app/dashboard-assureur/informatique/partenaires/actions';
import {
  CarteResume,
  ChampCheckbox,
  ChampNombre,
  ChampTexte,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

/** Miroir de la sortie de `GET /api/v1/vitrine/partenaires`. */
export interface PartenaireGestion {
  id: string;
  nom: string;
  logoUrl: string;
  siteUrl: string | null;
  ordreAffichage: number;
  actif: boolean;
}

/** Plafond de logos actifs (même valeur que l'API : `NB_MAX_PARTENAIRES_ACTIFS`). */
const PLAFOND = 30;

/** Champs communs ajout / édition (`defaultValue` réappliqués à chaque ouverture). */
function ChampsPartenaire({ p }: { p?: PartenaireGestion }) {
  return (
    <>
      <ChampTexte name="nom" label="Nom du partenaire" required minLength={2} maxLength={120} defaultValue={p?.nom} placeholder="Clinique Horizon" />
      <ChampTexte
        name="image"
        label={p ? 'Nouveau logo' : 'Logo'}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={!p}
        aide={
          p
            ? 'Laisser vide pour garder le logo actuel. JPEG, PNG ou WEBP, 5 Mo au plus.'
            : 'JPEG, PNG ou WEBP, 5 Mo au plus. Fond transparent (PNG) ou blanc conseillé, logo plutôt horizontal.'
        }
      />
      <ChampTexte
        name="siteUrl"
        label="Site du partenaire (facultatif)"
        type="url"
        maxLength={300}
        defaultValue={p?.siteUrl ?? ''}
        placeholder="https://www.exemple.ci"
        aide="Si renseigné, un clic sur le logo ouvre ce site dans un nouvel onglet."
      />
      <ChampNombre
        name="ordreAffichage"
        label="Ordre d’affichage"
        aide="0 = en premier. À ordre égal, les logos ajoutés en premier passent devant."
        min={0}
        max={999}
        step={1}
        defaultValue={p?.ordreAffichage ?? 0}
      />
      <ChampCheckbox name="actif" label="Affiché dans le bandeau de la page d’accueil" defaultChecked={p?.actif ?? true} />
    </>
  );
}

/**
 * Logos des partenaires de la société : bandeau défilant affiché juste après la bannière de SA page d'accueil (/{slug}). Écran réservé à
 * ASSUREUR_INFORMATIQUE (rôle exact) ; jusqu'à 30 logos actifs, par ordre d'affichage.
 */
export function PartenairesEcran({ partenaires, slug }: { partenaires: PartenaireGestion[]; slug: string | null }) {
  const router = useRouter();
  const [edite, setEdite] = useState<PartenaireGestion | null>(null);
  const actifs = partenaires.filter((p) => p.actif);

  const colonnes: ColonneTable<PartenaireGestion>[] = [
    {
      cle: 'logoUrl',
      entete: 'Logo',
      rendu: (p) => (
        // eslint-disable-next-line @next/next/no-img-element -- logos hébergés dans le stockage public, dimensions variables
        <img src={p.logoUrl} alt={`Logo de ${p.nom}`} className="h-10 w-24 rounded-md border bg-white object-contain p-1" />
      ),
    },
    { cle: 'nom', entete: 'Partenaire', triable: true, rendu: (p) => <span className="font-medium">{p.nom}</span> },
    {
      cle: 'siteUrl',
      entete: 'Site',
      rendu: (p) =>
        p.siteUrl ? (
          <a href={p.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            {p.siteUrl.replace(/^https?:\/\//, '').slice(0, 32)}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { cle: 'ordreAffichage', entete: 'Ordre', triable: true, aligneDroite: true },
    {
      cle: 'actif',
      entete: 'Affichage',
      valeur: (p) => (p.actif ? 'ACTIF' : 'INACTIF'),
      rendu: (p) =>
        p.actif ? <StatutBadge statut="ACTIF" ton="succes" libelle="Affiché" /> : <StatutBadge statut="INACTIF" ton="neutre" libelle="Masqué" />,
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Partenaires" valeur={partenaires.length} icon={Handshake} />
        <CarteResume libelle="Affichés" valeur={actifs.length} icon={Eye} indice={`${PLAFOND} au plus`} />
      </GrilleCartes>

      {slug && (
        <p className="text-sm text-muted-foreground">
          Le bandeau défile juste après la bannière de votre page d’accueil :{' '}
          <a href={`/${slug}`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
            /{slug}
          </a>
          .
        </p>
      )}

      <DataTable
        donnees={partenaires}
        cleLigne={(p) => p.id}
        colonnes={colonnes}
        recherche={{ placeholder: 'Nom…', champs: ['nom'] }}
        filtres={[
          {
            cle: 'actif',
            libelle: 'Affichage',
            options: [
              { valeur: 'ACTIF', libelle: 'Affichés' },
              { valeur: 'INACTIF', libelle: 'Masqués' },
            ],
            valeur: (row) => ((row as PartenaireGestion).actif ? 'ACTIF' : 'INACTIF'),
          },
        ]}
        actions={
          <FormulaireModal
            titre="Nouveau partenaire"
            description="Le logo apparaît dans le bandeau défilant de la page d’accueil de votre société, juste après la bannière."
            declencheurLabel="Ajouter un partenaire"
            libelleSoumettre="Ajouter au bandeau"
            onSoumettre={ajouterPartenaire}
            onSucces={() => router.refresh()}
          >
            <ChampsPartenaire />
          </FormulaireModal>
        }
        actionLigne={(p) => (
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setEdite(p)}>
              Modifier
            </Button>
            {p.actif ? (
              <ConfirmationAction
                action="archiver"
                libelles={{ titre: 'Masquer du bandeau', bouton: 'Masquer', verbe: 'masquer' }}
                element={`le logo de « ${p.nom} »`}
                consequence="Il n’est plus affiché dans le bandeau ; il reste ici sous « Masqué »."
                onConfirmer={() => changerVisibilitePartenaire(p.id, false)}
                onSucces={() => router.refresh()}
              />
            ) : (
              <ConfirmationAction
                action="desarchiver"
                libelles={{ titre: 'Afficher dans le bandeau', bouton: 'Afficher', verbe: 'afficher' }}
                element={`le logo de « ${p.nom} »`}
                consequence="Il est de nouveau affiché dans le bandeau défilant."
                onConfirmer={() => changerVisibilitePartenaire(p.id, true)}
                onSucces={() => router.refresh()}
              />
            )}
            <ConfirmationAction
              action="supprimer"
              element={`le partenaire « ${p.nom} »`}
              consequence="Son logo est retiré du bandeau et du stockage."
              onConfirmer={() => supprimerPartenaire(p.id)}
              onSucces={() => router.refresh()}
            />
          </div>
        )}
        vide="Aucun partenaire pour l’instant : ajoutez les logos des établissements, pharmacies et sociétés partenaires."
      />

      {edite && (
        <FormulaireModal
          key={edite.id}
          titre={`Modifier — ${edite.nom}`}
          ouvert
          onOuvertChange={(v) => !v && setEdite(null)}
          onSoumettre={(fd) => modifierPartenaire(edite.id, fd)}
          onSucces={() => {
            setEdite(null);
            router.refresh();
          }}
        >
          <ChampsPartenaire p={edite} />
        </FormulaireModal>
      )}
    </div>
  );
}
