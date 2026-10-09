'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  importerCatalogueExcel,
  validerImportCatalogue,
  type ImportCatalogueResume,
} from '@/app/superadmin/catalogue-national/actions';
import { ChampFichier, FormulaireModal, StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const LIBELLE_STATUT: Record<string, string> = {
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EN_ATTENTE_VALIDATION: 'attention',
  VALIDE: 'succes',
  REJETE: 'danger',
};

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');

function ImporterExcelForm({ type }: { type: 'actes' | 'medicaments' }) {
  const description =
    type === 'actes'
      ? "Colonnes attendues : code, libellé ; facultatives : catégorie, lettre_cle, coefficient, mode (ISOLE ou GROUPE), categorie_garantie, groupe_code. Chaque ligne est vérifiée (lettre-clé active, coefficient positif, groupe pour un acte groupé…) et les erreurs sont rapportées ligne par ligne. Un code déjà présent dans le catalogue national est mis à jour (jamais une erreur) — son statut d'homologation n'est pas modifié."
      : "Colonnes attendues : denomination_commune, nom_commercial, classe_therapeutique, prix_reference_xof, medicament_essentiel. Une dénomination déjà présente (insensible à la casse) est mise à jour (jamais une erreur) — son statut d'homologation n'est pas modifié.";
  return (
    <FormulaireModal
      titre={`Importer les ${type === 'actes' ? 'actes' : 'médicaments'} depuis Excel`}
      description={`${description} Aucune entrée n'est créée/modifiée à l'import — l'aperçu ci-dessous liste les lignes valides (nouvelles ou mises à jour) et en erreur ; la création/mise à jour réelle n'a lieu qu'à la validation.`}
      declencheurLabel="Importer depuis Excel"
      libelleSoumettre="Importer le fichier"
      onSoumettre={async (fd) => {
        const r = await importerCatalogueExcel(type, fd);
        if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
        return {
          ok: true,
          message: `Import créé : ${r.import.nbLignesValides} ligne(s) valide(s), ${r.import.nbLignesErreur} en erreur — voir « Imports » ci-dessous pour l'aperçu détaillé et la validation.`,
        };
      }}
      onSucces={() => {}}
    >
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

/** « B × 12,5 · Isolé · Analyses de laboratoire » — « Non cotée » ou « inchangée » selon le fichier. */
function libelleCotation(c: unknown): string {
  if (!c || typeof c !== 'object') return 'Inchangée (colonnes absentes du fichier)';
  const x = c as { lettreCleCode?: string | null; coefficient?: string | null; modeCotation?: string; categorieGarantie?: string | null; groupeCode?: string | null };
  if (!x.lettreCleCode) return x.categorieGarantie ? `Non cotée · garantie ${x.categorieGarantie}` : 'Non cotée';
  const mode = x.modeCotation === 'GROUPE' ? `Groupé (${x.groupeCode ?? '—'})` : 'Isolé';
  return `${x.lettreCleCode} × ${Number(x.coefficient ?? 0).toLocaleString('fr-FR')} · ${mode}${x.categorieGarantie ? ` · ${x.categorieGarantie}` : ''}`;
}

function DetailImport({ imp }: { imp: ImportCatalogueResume }) {
  const nouvelles = imp.lignesValides.filter((l) => !l.estMiseAJour);
  const misesAJour = imp.lignesValides.filter((l) => l.estMiseAJour);
  const colonnes =
    imp.type === 'ACTES'
      ? (['code', 'libelle', 'categorie', 'cotation'] as const)
      : (['denominationCommune', 'nomCommercial', 'classeTherapeutique', 'prixReferenceXof', 'medicamentEssentiel'] as const);
  const entetes: Record<string, string> = {
    code: 'Code',
    libelle: 'Libellé',
    categorie: 'Chapitre',
    cotation: 'Cotation',
    denominationCommune: 'DCI',
    nomCommercial: 'Nom commercial',
    classeTherapeutique: 'Classe',
    prixReferenceXof: 'Prix (F)',
    medicamentEssentiel: 'Essentiel',
  };

  const tableau = (lignes: Record<string, unknown>[], titre: string) => (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{titre} ({lignes.length})</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {colonnes.map((c) => (
              <th key={c} className="py-1">{entetes[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i} className="border-b last:border-0">
              {colonnes.map((c) => (
                <td key={c} className="py-1">
                  {c === 'cotation' ? libelleCotation(l.cotation) : typeof l[c] === 'boolean' ? (l[c] ? 'Oui' : 'Non') : String(l[c] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-3 border-t pt-3">
      {nouvelles.length > 0 && tableau(nouvelles, 'Nouvelles entrées')}
      {misesAJour.length > 0 && tableau(misesAJour, 'Doublons détectés — mise à jour')}
      {imp.erreursDetail.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-destructive">
            Lignes en erreur ({imp.erreursDetail.length})
          </p>
          <ul className="space-y-1 text-sm">
            {imp.erreursDetail.map((e) => (
              <li key={e.ligne} className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <span className="font-medium">Ligne {e.ligne}</span> :{' '}
                <span className="text-destructive">{e.erreurs.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ImportsCataloguePanel({
  type,
  imports,
}: {
  type: 'actes' | 'medicaments';
  imports: ImportCatalogueResume[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const typeApi = type === 'actes' ? 'ACTES' : 'MEDICAMENTS';
  const importsDuType = imports.filter((i) => i.type === typeApi);

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
      const r = await validerImportCatalogue(id);
      if (r.ok) {
        setMessage({ ok: true, texte: `Import validé : ${r.nbCrees} nouvelle(s) entrée(s), ${r.nbMisAJour} mise(s) à jour.` });
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
          Imports Excel ({importsDuType.filter((i) => i.statut === 'EN_ATTENTE_VALIDATION').length} en attente)
        </CardTitle>
        <ImporterExcelForm type={type} />
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
        {importsDuType.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun import pour l’instant.</p>
        )}
        {importsDuType.map((imp) => (
          <div key={imp.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{imp.fichierNom}</p>
                <p className="text-xs text-muted-foreground">
                  {dateHeureFr(imp.createdAt)} · {imp.nbLignesValides} valide(s) / {imp.nbLignesErreur} erreur(s) sur {imp.nbLignesTotal}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatutBadge statut={imp.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
                <Button size="xs" variant="ghost" onClick={() => toggle(imp.id)}>
                  {ouverts.has(imp.id) ? 'Masquer' : 'Voir le détail'}
                </Button>
                {imp.statut === 'EN_ATTENTE_VALIDATION' && (
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
