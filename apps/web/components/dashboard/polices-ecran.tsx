'use client';

import { FileText, ShieldCheck, ShieldX, FileClock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { creerDevis } from '@/app/dashboard-assureur/informatique/polices/actions';
import {
  CarteResume,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { LIBELLE_POLICE, TON_POLICE } from '@/lib/police';

export interface PoliceListe {
  id: string;
  numeroPolice: string;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
  createdAt: string;
  produit: { nom: string; version: number; statut: string } | null;
  souscripteur: { nom: string; type: string } | null;
  _count?: { avenants: number };
}
export interface OptionRef {
  id: string;
  nom: string;
  version?: number;
}


const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function PolicesEcran({
  polices,
  souscripteurs,
  produitsPublies,
}: {
  polices: PoliceListe[];
  souscripteurs: OptionRef[];
  produitsPublies: OptionRef[];
}) {
  const router = useRouter();
  const compte = (s: string) => polices.filter((p) => p.statut === s).length;

  const colonnes: ColonneTable<PoliceListe>[] = [
    { cle: 'numeroPolice', entete: 'N° police', triable: true },
    {
      cle: 'souscripteur',
      entete: 'Souscripteur',
      valeur: (p) => p.souscripteur?.nom ?? '',
      rendu: (p) => p.souscripteur?.nom ?? '—',
    },
    {
      cle: 'produit',
      entete: 'Produit',
      valeur: (p) => p.produit?.nom ?? '',
      rendu: (p) =>
        p.produit ? `${p.produit.nom} · v${p.produit.version}` : '—',
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (p) => (
        <StatutBadge
          statut={p.statut}
          map={TON_POLICE}
          libelles={LIBELLE_POLICE}
        />
      ),
    },
    {
      cle: 'dateDebut',
      entete: 'Début',
      triable: true,
      valeur: (p) => p.dateDebut ?? '',
      rendu: (p) => dateFr(p.dateDebut),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Polices" valeur={polices.length} icon={FileText} />
        <CarteResume
          libelle="Devis / en cours"
          valeur={compte('DEVIS') + compte('EN_SOUSCRIPTION')}
          icon={FileClock}
        />
        <CarteResume libelle="Actives" valeur={compte('ACTIVE')} icon={ShieldCheck} />
        <CarteResume
          libelle="Résiliées / non renouv."
          valeur={compte('RESILIEE') + compte('NON_RENOUVELEE')}
          icon={ShieldX}
        />
      </GrilleCartes>

      <DataTable
        donnees={polices}
        cleLigne={(p) => p.id}
        parPage={10}
        recherche={{
          placeholder: 'N° police, souscripteur…',
          champs: ['numeroPolice', 'souscripteur.nom', 'produit.nom'],
        }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: Object.entries(LIBELLE_POLICE).map(([valeur, libelle]) => ({
              valeur,
              libelle,
            })),
          },
        ]}
        colonnes={colonnes}
        actions={
          <FormulaireModal
            titre="Nouveau devis"
            description="Le devis est créé au statut DEVIS. Seuls les produits PUBLIÉS sont proposés."
            declencheurLabel="Nouveau devis"
            libelleSoumettre="Créer le devis"
            onSoumettre={async (fd) =>
              creerDevis({
                souscripteurId: String(fd.get('souscripteurId') ?? ''),
                produitId: String(fd.get('produitId') ?? ''),
                dateDebut: String(fd.get('dateDebut') ?? '') || undefined,
                dateFin: String(fd.get('dateFin') ?? '') || undefined,
              })
            }
            onSucces={() => router.refresh()}
          >
            {souscripteurs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun souscripteur. Créez-en un dans « Souscripteurs ».
              </p>
            ) : (
              <ChampSelect
                name="souscripteurId"
                label="Souscripteur"
                required
                placeholder="Choisir un souscripteur…"
                options={souscripteurs.map((s) => ({ valeur: s.id, libelle: s.nom }))}
              />
            )}
            {produitsPublies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun produit publié. Publiez un produit dans « Produits » avant
                de créer une police.
              </p>
            ) : (
              <ChampSelect
                name="produitId"
                label="Produit (publiés uniquement)"
                required
                placeholder="Choisir un produit…"
                options={produitsPublies.map((p) => ({
                  valeur: p.id,
                  libelle: `${p.nom}${p.version ? ` · v${p.version}` : ''}`,
                }))}
              />
            )}
            <ChampTexte name="dateDebut" label="Date de début (optionnel)" type="date" />
            <ChampTexte name="dateFin" label="Date de fin (optionnel)" type="date" />
          </FormulaireModal>
        }
        actionLigne={(p) => (
          <Button asChild size="xs" variant="ghost">
            <Link href={`/dashboard-assureur/informatique/polices/${p.id}`}>
              Détails
            </Link>
          </Button>
        )}
        vide="Aucune police pour l’instant."
      />
    </div>
  );
}
