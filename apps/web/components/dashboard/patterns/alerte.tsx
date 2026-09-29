import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type TonAlerte = 'succes' | 'erreur' | 'avertissement' | 'info';

/**
 * Annonce aux technologies d'assistance :
 *  - `immediate` → `role="alert"` (interrompt la lecture : erreur bloquante) ;
 *  - `polie`     → `role="status"` (lu à la prochaine pause : retour d'action) ;
 *  - `aucune`    → bandeau statique, présent dès le rendu (aide, rappel).
 */
export type AnnonceAlerte = 'immediate' | 'polie' | 'aucune';

// Couleurs : celles déjà en usage dans l'application pour ces bandeaux (succès
// emerald, avertissement amber d'`EcranMessage`, info sky du `Badge`), réunies
// ici en un seul endroit. Erreur : tokens `destructive` du thème. Contrastes
// texte/fond ≥ 5,3:1 en clair et en sombre.
const TON: Record<TonAlerte, { classe: string; icone: LucideIcon }> = {
  succes: {
    classe:
      'border-emerald-300/70 bg-emerald-50/50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400',
    icone: CheckCircle2,
  },
  erreur: {
    classe: 'border-destructive/40 bg-destructive/5 text-destructive',
    icone: XCircle,
  },
  avertissement: {
    classe:
      'border-amber-300/70 bg-amber-50/60 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300',
    icone: AlertTriangle,
  },
  info: {
    classe:
      'border-sky-300/70 bg-sky-50/50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300',
    icone: Info,
  },
};

const ROLE: Record<AnnonceAlerte, 'alert' | 'status' | undefined> = {
  immediate: 'alert',
  polie: 'status',
  aucune: undefined,
};

/**
 * Bandeau de message (succès, erreur, avertissement, information).
 * L'icône double la couleur : le ton n'est jamais porté par la couleur seule.
 *
 * Par défaut, une erreur est annoncée immédiatement et les autres tons
 * poliment ; passer `annonce="aucune"` pour un bandeau présent dès l'affichage.
 * Pour être annoncé, le bandeau doit apparaître APRÈS le premier rendu
 * (rendu conditionnel sur un état), comme les messages de retour d'action.
 */
export function Alerte({
  ton,
  titre,
  annonce,
  className,
  children,
}: {
  ton: TonAlerte;
  titre?: string;
  annonce?: AnnonceAlerte;
  className?: string;
  children?: React.ReactNode;
}) {
  const { classe, icone: Icone } = TON[ton];
  const role = ROLE[annonce ?? (ton === 'erreur' ? 'immediate' : 'polie')];

  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2 rounded-md border p-2 text-sm',
        classe,
        className,
      )}
    >
      <Icone aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {titre && <p className="font-medium">{titre}</p>}
        {children}
      </div>
    </div>
  );
}
