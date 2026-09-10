'use client';

import { FileStack, Package, PackageCheck, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { creerProduit } from '@/app/dashboard-assureur/informatique/produits/actions';
import {
  CarteResume,
  ChampTexte,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface Produit {
  id: string;
  nom: string;
  version: number;
  statut: 'BROUILLON' | 'PUBLIE' | 'ARCHIVE';
  datePublication: string | null;
  createdAt: string;
  _count?: { garanties: number };
}

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  ARCHIVE: 'Archivé',
};

export function ProduitsEcran({ produits }: { produits: Produit[] }) {
  const router = useRouter();

  const parStatut = (s: string) => produits.filter((p) => p.statut === s).length;

  const colonnes: ColonneTable<Produit>[] = [
    { cle: 'nom', entete: 'Nom', triable: true },
    {
      cle: 'version',
      entete: 'Version',
      triable: true,
      aligneDroite: true,
      rendu: (p) => `v${p.version}`,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (p) => (
        <StatutBadge statut={p.statut} libelle={LIBELLE_STATUT[p.statut]} />
      ),
    },
    {
      cle: 'garanties',
      entete: 'Garanties',
      aligneDroite: true,
      valeur: (p) => p._count?.garanties ?? 0,
      rendu: (p) => p._count?.garanties ?? 0,
    },
    {
      cle: 'datePublication',
      entete: 'Publié le',
      triable: true,
      valeur: (p) => p.datePublication ?? '',
      rendu: (p) =>
        p.datePublication
          ? new Date(p.datePublication).toLocaleDateString('fr-FR')
          : '—',
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Produits" valeur={produits.length} icon={Package} />
        <CarteResume
          libelle="Brouillons"
          valeur={parStatut('BROUILLON')}
          icon={PackageOpen}
        />
        <CarteResume
          libelle="Publiés"
          valeur={parStatut('PUBLIE')}
          icon={PackageCheck}
        />
        <CarteResume
          libelle="Archivés"
          valeur={parStatut('ARCHIVE')}
          icon={FileStack}
        />
      </GrilleCartes>

      <DataTable
        donnees={produits}
        cleLigne={(p) => p.id}
        parPage={10}
        recherche={{ placeholder: 'Nom du produit…', champs: ['nom'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: [
              { valeur: 'BROUILLON', libelle: 'Brouillon' },
              { valeur: 'PUBLIE', libelle: 'Publié' },
              { valeur: 'ARCHIVE', libelle: 'Archivé' },
            ],
          },
        ]}
        colonnes={colonnes}
        actions={
          <FormulaireModal
            titre="Nouveau produit"
            description="Le produit est créé en brouillon. Ajoutez ses garanties puis publiez-le."
            declencheurLabel="Nouveau produit"
            libelleSoumettre="Créer le brouillon"
            onSoumettre={async (fd) =>
              creerProduit({ nom: String(fd.get('nom') ?? '') })
            }
            onSucces={() => router.refresh()}
          >
            <ChampTexte
              name="nom"
              label="Nom du produit"
              required
              placeholder="Ex. Santé Essentiel, Famille Plus…"
            />
          </FormulaireModal>
        }
        actionLigne={(p) => (
          <Button asChild size="xs" variant="ghost">
            <Link href={`/dashboard-assureur/informatique/produits/${p.id}`}>
              Détails
            </Link>
          </Button>
        )}
        vide="Aucun produit pour l’instant."
      />
    </div>
  );
}
