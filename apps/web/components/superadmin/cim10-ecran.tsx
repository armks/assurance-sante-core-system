'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  changerStatutMaladieCim10,
  creerMaladieCim10,
  importerMaladiesCim10,
  modifierMaladieCim10,
  supprimerMaladieCim10,
  type ResumeImportCim10,
} from '@/app/superadmin/cim10/actions';
import {
  Alerte,
  ChampFichier,
  ChampTexte,
  ConfirmationAction,
  DataTable,
  FiltresServeur,
  FormulaireModal,
  PaginationServeur,
  StatutBadge,
  type ColonneTable,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface MaladieCim10 {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
}

export type PageMaladies = PageServeur<MaladieCim10> & { nbActives: number };

/** Gestion du référentiel CIM-10 par le superadmin : ajout, import CSV, modification, désactivation, suppression. */
export function Cim10Ecran({ donnees }: { donnees: PageMaladies }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [resume, setResume] = useState<ResumeImportCim10 | null>(null);
  const succes = (m: string) => {
    setMessage(m);
    router.refresh();
  };

  const colonnes: ColonneTable<MaladieCim10>[] = [
    { cle: 'code', entete: 'Code', className: 'font-mono text-sm font-semibold' },
    { cle: 'libelle', entete: 'Maladie' },
    {
      cle: 'actif',
      entete: 'Statut',
      rendu: (m) => (
        <StatutBadge statut={m.actif ? 'ACTIF' : 'INACTIF'} ton={m.actif ? 'succes' : 'neutre'} libelles={{ ACTIF: 'Active', INACTIF: 'Désactivée' }} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {message && <Alerte ton="succes">{message}</Alerte>}
      {resume && (
        <Alerte ton={resume.nbErreurs > 0 ? 'avertissement' : 'succes'}>
          Import terminé : {resume.lignesLues.toLocaleString('fr-FR')} lignes lues — {resume.crees.toLocaleString('fr-FR')} créées,{' '}
          {resume.modifies.toLocaleString('fr-FR')} mises à jour, {resume.inchanges.toLocaleString('fr-FR')} inchangées
          {resume.nbErreurs > 0 && (
            <>
              , {resume.nbErreurs} ligne(s) refusée(s) :
              <ul className="mt-1 list-disc pl-5 text-xs">
                {resume.erreurs.slice(0, 10).map((e) => (
                  <li key={e.ligne}>
                    ligne {e.ligne} — {e.raison} <span className="font-mono">{e.contenu}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Alerte>
      )}
      <p className="text-sm text-muted-foreground">
        {donnees.nbActives.toLocaleString('fr-FR')} maladie(s) active(s) proposée(s) aux médecins.
      </p>
      <FiltresServeur
        recherche={{ placeholder: 'Code ou maladie…' }}
        selects={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: [
              { valeur: 'ACTIF', libelle: 'Actives' },
              { valeur: 'INACTIF', libelle: 'Désactivées' },
            ],
          },
        ]}
      />
      <DataTable
        donnees={donnees.items}
        cleLigne={(m) => m.id}
        parPage={donnees.limite}
        colonnes={colonnes}
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <FormulaireModal
              titre="Importer la classification"
              description="Fichier texte ou CSV (UTF-8), une maladie par ligne : « code;libellé » (ex. B50.9;Paludisme à Plasmodium falciparum, sans précision). Un code déjà présent voit son libellé mis à jour."
              declencheurLabel="Importer un fichier"
              libelleSoumettre="Importer"
              onSoumettre={async (fd) => {
                const r = await importerMaladiesCim10(fd);
                if (!r.ok) return r;
                setResume(r.resume);
                return { ok: true, message: 'Import terminé.' };
              }}
              onSucces={() => {
                setMessage(null);
                router.refresh();
              }}
            >
              <ChampFichier name="fichier" label="Fichier CSV / texte" required accept=".csv,.txt,text/csv,text/plain" />
            </FormulaireModal>
            <FormulaireModal
              titre="Nouvelle maladie"
              description="Code CIM-10 : une lettre, deux chiffres, puis au besoin un point et un complément (A00, B50.9)."
              declencheurLabel="Ajouter une maladie"
              libelleSoumettre="Ajouter"
              onSoumettre={async (fd) =>
                creerMaladieCim10({
                  code: String(fd.get('code') ?? '').trim().toUpperCase(),
                  libelle: String(fd.get('libelle') ?? ''),
                })
              }
              onSucces={() => succes('Maladie ajoutée.')}
            >
              <ChampTexte name="code" label="Code CIM-10" required maxLength={10} placeholder="B50.9" />
              <ChampTexte name="libelle" label="Maladie" required maxLength={300} />
            </FormulaireModal>
          </span>
        }
        actionLigne={(m) => (
          <span className="inline-flex items-center gap-1">
            <FormulaireModal
              titre={`Modifier ${m.code}`}
              mode="center"
              declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) => modifierMaladieCim10(m.id, { libelle: String(fd.get('libelle') ?? '') })}
              onSucces={() => succes('Maladie modifiée.')}
            >
              <ChampTexte name="libelle" label="Maladie" required maxLength={300} defaultValue={m.libelle} />
            </FormulaireModal>
            {m.actif ? (
              <ConfirmationAction
                action="archiver"
                element={`la maladie « ${m.code} — ${m.libelle} »`}
                consequence="Elle n’est plus proposée aux médecins ; les consultations déjà enregistrées gardent leur code."
                libelles={{ titre: 'Désactiver', bouton: 'Désactiver', verbe: 'désactiver' }}
                onConfirmer={() => changerStatutMaladieCim10(m.id, 'desactiver')}
                onSucces={() => succes('Maladie désactivée.')}
              />
            ) : (
              <ConfirmationAction
                action="desarchiver"
                element={`la maladie « ${m.code} — ${m.libelle} »`}
                libelles={{ titre: 'Réactiver', bouton: 'Réactiver', verbe: 'réactiver' }}
                onConfirmer={() => changerStatutMaladieCim10(m.id, 'reactiver')}
                onSucces={() => succes('Maladie réactivée.')}
              />
            )}
            <ConfirmationAction
              action="supprimer"
              element={`la maladie « ${m.code} — ${m.libelle} »`}
              consequence="Les consultations déjà enregistrées gardent leur code."
              onConfirmer={() => supprimerMaladieCim10(m.id)}
              onSucces={() => succes('Maladie supprimée.')}
            />
          </span>
        )}
        vide="Aucune maladie. Importez la classification ou ajoutez-en une."
      />
      <PaginationServeur page={donnees.page} pages={donnees.pages} total={donnees.total} limite={donnees.limite} />
    </div>
  );
}
