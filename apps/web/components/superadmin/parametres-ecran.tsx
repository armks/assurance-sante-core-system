'use client';

import { useRouter } from 'next/navigation';

import { definirParametre } from '@/app/superadmin/parametres/actions';
import {
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface Parametre {
  id: string;
  cle: string;
  valeur: unknown;
  description: string | null;
  updatedAt: string;
}

const apercu = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
};

export function ParametresEcran({ parametres }: { parametres: Parametre[] }) {
  const router = useRouter();

  const colonnes: ColonneTable<Parametre>[] = [
    { cle: 'cle', entete: 'Clé', triable: true, className: 'font-mono text-xs' },
    {
      cle: 'description',
      entete: 'Description',
      rendu: (p) => p.description ?? '—',
    },
    {
      cle: 'valeur',
      entete: 'Valeur',
      className: 'font-mono text-xs text-muted-foreground',
      rendu: (p) => apercu(p.valeur),
    },
  ];

  return (
    <DataTable
      donnees={parametres}
      cleLigne={(p) => p.cle}
      parPage={0}
      recherche={{ placeholder: 'Clé, description…', champs: ['cle', 'description'] }}
      colonnes={colonnes}
      actionLigne={(p) => (
        <FormulaireModal
          titre={`Modifier « ${p.cle} »`}
          description="La valeur doit rester un JSON valide (tableau, objet, nombre…)."
          declencheur={
            <Button size="xs" variant="ghost">
              Modifier
            </Button>
          }
          libelleSoumettre="Enregistrer"
          onSoumettre={async (fd) =>
            definirParametre(
              p.cle,
              String(fd.get('valeur') ?? ''),
              String(fd.get('description') ?? ''),
            )
          }
          onSucces={() => router.refresh()}
        >
          <ChampZone
            name="valeur"
            label="Valeur (JSON)"
            required
            defaultValue={JSON.stringify(p.valeur, null, 2)}
            className="[&_textarea]:min-h-48 [&_textarea]:font-mono [&_textarea]:text-xs"
          />
          <ChampTexte
            name="description"
            label="Description"
            defaultValue={p.description ?? ''}
          />
        </FormulaireModal>
      )}
      vide="Aucun paramètre."
    />
  );
}
