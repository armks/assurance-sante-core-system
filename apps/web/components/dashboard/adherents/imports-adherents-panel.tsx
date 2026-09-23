'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  importerAdherentsExcel,
  validerImportAdherents,
} from '@/app/dashboard-assureur/adherents-actions';
import {
  ChampFichier,
  ChampSelect,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImportAdherentsResume, OptionRef } from './types';

const LIBELLE_STATUT: Record<string, string> = {
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger'> = {
  EN_ATTENTE_VALIDATION: 'attention',
  VALIDE: 'succes',
  REJETE: 'danger',
};

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

function ImporterExcelForm({ souscripteurs }: { souscripteurs: OptionRef[] }) {
  return (
    <FormulaireModal
      titre="Importer des adhérents depuis Excel"
      description="Colonnes attendues : nom, prénom, téléphone, email, date de naissance. La police/formule est déterminée par la société choisie, pas répétée ligne par ligne. Aucun adhérent n'est créé à l'import — l'aperçu ci-dessous liste les lignes valides et en erreur ; la création réelle (avec les cartes) n'a lieu qu'à la validation."
      declencheurLabel="Importer depuis Excel"
      libelleSoumettre="Importer le fichier"
      onSoumettre={async (fd) => {
        const souscripteurId = String(fd.get('souscripteurId') ?? '');
        const r = await importerAdherentsExcel(souscripteurId, fd);
        if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
        return {
          ok: true,
          message: `Import créé : ${r.import.nbLignesValides} ligne(s) valide(s), ${r.import.nbLignesErreur} en erreur — voir « Imports en attente de validation » pour l'aperçu détaillé et la validation.`,
        };
      }}
      onSucces={() => {}}
    >
      <ChampSelect
        name="souscripteurId"
        label="Société cliente"
        required
        placeholder="Choisir…"
        options={souscripteurs.map((s) => ({ valeur: s.id, libelle: s.nom }))}
      />
      <ChampFichier
        name="fichier"
        label="Fichier Excel (.xlsx)"
        required
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aide="5 Mo maximum."
      />
    </FormulaireModal>
  );
}

function DetailImport({ imp }: { imp: ImportAdherentsResume }) {
  return (
    <div className="space-y-3 border-t pt-3">
      {imp.lignesValides.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Lignes valides ({imp.lignesValides.length})
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1">Nom / prénom</th>
                <th className="py-1">Téléphone</th>
                <th className="py-1">Email</th>
                <th className="py-1">Naissance</th>
              </tr>
            </thead>
            <tbody>
              {imp.lignesValides.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{l.nom} {l.prenom}</td>
                  <td className="py-1">{l.telephone}</td>
                  <td className="py-1">{l.email}</td>
                  <td className="py-1">{new Date(l.dateNaissance).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {imp.erreursDetail.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-destructive">
            Lignes en erreur ({imp.erreursDetail.length})
          </p>
          <ul className="space-y-1 text-sm">
            {imp.erreursDetail.map((e) => (
              <li key={e.ligne} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <span className="font-medium">Ligne {e.ligne}</span> — {e.donnees.nom} {e.donnees.prenom} :{' '}
                <span className="text-destructive">{e.erreurs.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ImportsAdherentsPanel({
  imports,
  souscripteurs,
  peutImporter,
  peutValider,
}: {
  imports: ImportAdherentsResume[];
  souscripteurs: OptionRef[];
  peutImporter: boolean;
  peutValider: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setOuverts((s) => {
      const copie = new Set(s);
      if (copie.has(id)) copie.delete(id);
      else copie.add(id);
      return copie;
    });
  }

  function valider(id: string) {
    start(async () => {
      const r = await validerImportAdherents(id);
      if (r.ok) {
        setMessage({ ok: true, texte: `Import validé : ${r.nbAdherentsCrees} adhérent(s) créé(s) avec leur carte.` });
        router.refresh();
      } else {
        setMessage({ ok: false, texte: r.error });
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">
          Imports en attente de validation ({imports.filter((i) => i.statut === 'EN_ATTENTE_VALIDATION').length})
        </CardTitle>
        {peutImporter && <ImporterExcelForm souscripteurs={souscripteurs} />}
      </CardHeader>
      <CardContent className="space-y-3">
        {message && (
          <p
            className={
              message.ok
                ? 'rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
                : 'rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive'
            }
          >
            {message.texte}
          </p>
        )}
        {imports.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun import pour l’instant.</p>
        )}
        {imports.map((imp) => (
          <div key={imp.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {imp.fichierNom} — {imp.souscripteur.nom}
                </p>
                <p className="text-xs text-muted-foreground">
                  {dateHeureFr(imp.createdAt)} · {imp.nbLignesValides} valide(s) / {imp.nbLignesErreur} erreur(s) sur {imp.nbLignesTotal}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatutBadge statut={imp.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
                <Button size="xs" variant="ghost" onClick={() => toggle(imp.id)}>
                  {ouverts.has(imp.id) ? 'Masquer' : 'Voir le détail'}
                </Button>
                {imp.statut === 'EN_ATTENTE_VALIDATION' && peutValider && (
                  <Button size="xs" disabled={pending || imp.nbLignesValides === 0} onClick={() => valider(imp.id)}>
                    Valider l'import
                  </Button>
                )}
              </div>
            </div>
            {ouverts.has(imp.id) && <DetailImport imp={imp} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
