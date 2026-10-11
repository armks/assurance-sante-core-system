'use client';

import { actionMasseCatalogue, type ResultatActionMasse } from '@/app/superadmin/catalogue-national/actions';
import { Alerte, ConfirmationAction } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface ElementSelectionne {
  id: string;
  nom: string;
  /** Élément déjà archivé (retiré du catalogue). */
  archive: boolean;
}

const VERBE_RESULTAT: Record<string, string> = {
  archiver: 'archivé',
  desarchiver: 'désarchivé',
  supprimer: 'supprimé',
};

/** « N éléments (A, B, C et 2 autres) » — nombre et quelques noms pour la confirmation. */
export function resumeSelection(nomPluriel: string, nomSingulier: string, noms: string[]): string {
  const n = noms.length;
  const quelques = noms.slice(0, 3).join(', ');
  const reste = n > 3 ? ` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}` : '';
  return `${n} ${n > 1 ? nomPluriel : nomSingulier} sélectionné${n > 1 ? 's' : ''} (${quelques}${reste})`;
}

/**
 * Barre d'actions de masse du catalogue national (SUPERADMIN) : archiver / désarchiver (simple désactivation, réversible) et
 * supprimer (suppression logique des seuls éléments jamais importés). Confirmation partagée (`ConfirmationAction`) ; le serveur
 * contrôle CHAQUE élément et renvoie un résultat partiel, affiché par `ResultatMasse`.
 */
export function ActionsMasseCatalogue({
  type,
  elements,
  onTermine,
}: {
  type: 'actes' | 'medicaments';
  elements: ElementSelectionne[];
  onTermine: (r: ResultatActionMasse) => void;
}) {
  const noms = elements.map((e) => e.nom);
  const [pluriel, singulier] = type === 'actes' ? ['actes', 'acte'] : ['médicaments', 'médicament'];
  const element = resumeSelection(pluriel, singulier, noms);
  const lancer = (action: 'archiver' | 'desarchiver' | 'supprimer') => async () => {
    const r = await actionMasseCatalogue(type, action, elements.map((e) => e.id));
    if (!r.ok) return { ok: false as const, error: r.error };
    onTermine(r.resultat);
    return { ok: true as const };
  };
  const aArchiver = elements.some((e) => !e.archive);
  const aDesarchiver = elements.some((e) => e.archive);
  return (
    <>
      {aArchiver && (
        <ConfirmationAction
          action="archiver"
          element={element}
          consequence="Simple désactivation, réversible : ils ne seront plus proposés à l’import ; les copies déjà importées par les organisations ne changent pas."
          onConfirmer={lancer('archiver')}
          declencheur={<Button size="xs" variant="outline" data-testid="masse-archiver">Archiver la sélection</Button>}
        />
      )}
      {aDesarchiver && (
        <ConfirmationAction
          action="desarchiver"
          element={element}
          consequence="Ils seront de nouveau proposés à l’import."
          onConfirmer={lancer('desarchiver')}
          declencheur={<Button size="xs" variant="outline" data-testid="masse-desarchiver">Désarchiver la sélection</Button>}
        />
      )}
      <ConfirmationAction
        action="supprimer"
        element={element}
        consequence="Suppression logique, seulement pour les éléments qu’aucune organisation n’a importés ; les autres sont refusés avec leur raison."
        onConfirmer={lancer('supprimer')}
        declencheur={<Button size="xs" variant="ghost" data-testid="masse-supprimer">Supprimer la sélection</Button>}
      />
    </>
  );
}

/** Résultat détaillé d'une action de masse : réussis, refusés avec leur raison. */
export function ResultatMasse({ resultat, onFermer }: { resultat: ResultatActionMasse; onFermer: () => void }) {
  const verbe = VERBE_RESULTAT[resultat.action] ?? resultat.action;
  const ton = resultat.refuses === 0 ? 'succes' : resultat.reussis === 0 ? 'erreur' : 'avertissement';
  return (
    <Alerte ton={ton} titre={`${resultat.reussis} élément${resultat.reussis > 1 ? 's' : ''} ${verbe}${resultat.reussis > 1 ? 's' : ''} sur ${resultat.demandes}`}>
      <div className="space-y-2 text-sm" data-testid="resultat-masse">
        {resultat.reussis > 0 && (
          <div>
            <p className="font-medium">Réussis ({resultat.reussis})</p>
            <ul className="list-disc pl-5">
              {resultat.resultats.filter((r) => r.ok).map((r) => (
                <li key={r.id}>{r.nom}</li>
              ))}
            </ul>
          </div>
        )}
        {resultat.refuses > 0 && (
          <div>
            <p className="font-medium">Refusés ({resultat.refuses})</p>
            <ul className="list-disc pl-5">
              {resultat.resultats.filter((r) => !r.ok).map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.nom}</span> — {r.raison}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button size="xs" variant="outline" onClick={onFermer}>Fermer le résultat</Button>
      </div>
    </Alerte>
  );
}
