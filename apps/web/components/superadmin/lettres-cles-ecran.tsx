'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  changerStatutLettreCle,
  creerLettreCle,
  modifierLettreCle,
  supprimerLettreCle,
} from '@/app/superadmin/lettres-cles/actions';
import { verifierAction } from '@/app/dependances-actions';
import {
  Alerte,
  ChampNombre,
  ChampTexte,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface LettreCle {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
  ordre: number;
  nbActesNationaux: number;
  nbActesOrganisations: number;
}

/** Gestion des lettres-clés par le superadmin : créer, modifier, désactiver / réactiver, supprimer (ADR-007). */
export function LettresClesEcran({ lettres }: { lettres: LettreCle[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [voirInactives, setVoirInactives] = useState(false);
  const inactives = lettres.filter((l) => !l.actif).length;
  const visibles = voirInactives ? lettres : lettres.filter((l) => l.actif);
  const succes = (m: string) => {
    setMessage(m);
    router.refresh();
  };

  const colonnes: ColonneTable<LettreCle>[] = [
    { cle: 'code', entete: 'Code', triable: true, className: 'font-mono text-sm font-semibold' },
    { cle: 'libelle', entete: 'Libellé', triable: true },
    { cle: 'ordre', entete: 'Ordre', triable: true, aligneDroite: true },
    {
      cle: 'usage',
      entete: 'Actes cotés',
      aligneDroite: true,
      valeur: (l) => l.nbActesNationaux + l.nbActesOrganisations,
      rendu: (l) => `${l.nbActesNationaux} national${l.nbActesNationaux > 1 ? 'aux' : ''} · ${l.nbActesOrganisations} en organisation${l.nbActesOrganisations > 1 ? 's' : ''}`,
    },
    {
      cle: 'actif',
      entete: 'Statut',
      rendu: (l) => (
        <StatutBadge statut={l.actif ? 'ACTIF' : 'INACTIF'} ton={l.actif ? 'succes' : 'neutre'} libelles={{ ACTIF: 'Active', INACTIF: 'Désactivée' }} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {message && <Alerte ton="succes">{message}</Alerte>}
      {inactives > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirInactives} onChange={(e) => setVoirInactives(e.target.checked)} />
          Désactivées ({inactives})
        </label>
      )}
      <DataTable
        donnees={visibles}
        cleLigne={(l) => l.id}
        parPage={15}
        recherche={{ placeholder: 'Code, libellé…', champs: ['code', 'libelle'] }}
        colonnes={colonnes}
        actions={
          <FormulaireModal
            titre="Nouvelle lettre-clé"
            description="Le code comporte 1 à 6 lettres majuscules. Aucune valeur chiffrée n’est saisie ici."
            declencheurLabel="Ajouter une lettre-clé"
            libelleSoumettre="Créer la lettre-clé"
            onSoumettre={async (fd) =>
              creerLettreCle({
                code: String(fd.get('code') ?? '').trim().toUpperCase(),
                libelle: String(fd.get('libelle') ?? ''),
                ordre: fd.get('ordre') ? Number(fd.get('ordre')) : undefined,
              })
            }
            onSucces={() => succes('Lettre-clé créée.')}
          >
            <ChampTexte name="code" label="Code" required maxLength={6} placeholder="KC" />
            <ChampTexte name="libelle" label="Libellé" required />
            <ChampNombre name="ordre" label="Ordre d’affichage" min={0} step="1" />
          </FormulaireModal>
        }
        actionLigne={(l) => (
          <span className="inline-flex items-center gap-1">
            <FormulaireModal
              titre={`Modifier la lettre-clé ${l.code}`}
              mode="center"
              declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                modifierLettreCle(l.id, {
                  libelle: String(fd.get('libelle') ?? ''),
                  ordre: fd.get('ordre') ? Number(fd.get('ordre')) : undefined,
                })
              }
              onSucces={() => succes('Lettre-clé modifiée.')}
            >
              <ChampTexte name="libelle" label="Libellé" required defaultValue={l.libelle} />
              <ChampNombre name="ordre" label="Ordre d’affichage" min={0} step="1" defaultValue={l.ordre} />
            </FormulaireModal>
            {l.actif ? (
              <ConfirmationAction
                action="archiver"
                element={`la lettre-clé « ${l.code} — ${l.libelle} »`}
                consequence="Elle n’est plus proposée à la cotation ; les actes déjà cotés sont conservés."
                libelles={{ titre: 'Désactiver', bouton: 'Désactiver', verbe: 'désactiver' }}
                verifier={() => verifierAction('lettreCle', l.id, 'archiver')}
                onConfirmer={() => changerStatutLettreCle(l.id, 'desactiver')}
                onSucces={() => succes('Lettre-clé désactivée.')}
              />
            ) : (
              <ConfirmationAction
                action="desarchiver"
                element={`la lettre-clé « ${l.code} — ${l.libelle} »`}
                libelles={{ titre: 'Réactiver', bouton: 'Réactiver', verbe: 'réactiver' }}
                verifier={() => verifierAction('lettreCle', l.id, 'desarchiver')}
                onConfirmer={() => changerStatutLettreCle(l.id, 'reactiver')}
                onSucces={() => succes('Lettre-clé réactivée.')}
              />
            )}
            <ConfirmationAction
              action="supprimer"
              element={`la lettre-clé « ${l.code} — ${l.libelle} »`}
              consequence="Possible seulement si aucun acte ne la porte."
              verifier={() => verifierAction('lettreCle', l.id, 'supprimer')}
              onConfirmer={() => supprimerLettreCle(l.id)}
              onSucces={() => succes('Lettre-clé supprimée.')}
            />
          </span>
        )}
        vide="Aucune lettre-clé."
      />
    </div>
  );
}
