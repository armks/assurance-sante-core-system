import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Tonalités sémantiques d'un statut. */
export type TonStatut = 'succes' | 'attention' | 'danger' | 'info' | 'neutre';

const TON_VERS_VARIANT: Record<
  TonStatut,
  'success' | 'warning' | 'danger' | 'info' | 'muted'
> = {
  succes: 'success',
  attention: 'warning',
  danger: 'danger',
  info: 'info',
  neutre: 'muted',
};

/**
 * Déduction automatique de la tonalité à partir des jetons de statut les plus
 * courants du domaine (polices, tickets, codes, homologation, cotisations…).
 * Surchargeable via la prop `map` (statut → tonalité) ou `ton` (force).
 */
const REGLES: [RegExp, TonStatut][] = [
  [
    /^(ACTIF|ACTIVE|VALIDE|VALIDEE|CONFIRME|HOMOLOGUE|REGLEE|PAYEE|PUBLIE|OUVERT|EN_COURS|ACCEPTE|APPLIQUE|COMPLETEMENT_DELIVREE|UTILISE_COMPLET|ACCEPTEE)/,
    'succes',
  ],
  [
    /^(EN_ATTENTE|EN_VALIDATION|EN_ATTENTE_VALIDATION_INFORMATIQUE|BROUILLON|DEVIS|EMIS|EMISE|PROPOSE|A_PAYER|PRESENTE_PHARMACIE|UTILISE_PARTIEL|PARTIELLEMENT_DELIVREE|CONFIRME_PATIENT|SUSPENDU|SUSPENDUE|EN_SOUSCRIPTION)/,
    'attention',
  ],
  [
    /^(RESILIE|RESILIEE|EXPIRE|EXPIREE|ANNULE|ANNULEE|REJETE|REJETEE|REFUSE|RETIRE|FORCE_CLOS|EN_RETARD|REVOQUEE|CONTESTEE|NON_RENOUVELEE)/,
    'danger',
  ],
  [/^(CLOTURE|CLOTUREE|TERMINEE|ARCHIVE|RENOUVELEE|TRANSFERE)/, 'neutre'],
];

function tonAuto(statut: string): TonStatut {
  const s = statut.toUpperCase();
  for (const [re, ton] of REGLES) if (re.test(s)) return ton;
  return 'neutre';
}

/** Rend le statut lisible : `EN_ATTENTE_VALIDATION` → `En attente validation`. */
function libelleAuto(statut: string): string {
  const t = statut.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function StatutBadge({
  statut,
  ton,
  map,
  libelle,
  libelles,
  className,
}: {
  statut: string;
  /** Force la tonalité (sinon déduite du statut ou de `map`). */
  ton?: TonStatut;
  /** Table de correspondance statut → tonalité, prioritaire sur l'auto. */
  map?: Record<string, TonStatut>;
  /** Texte affiché (sinon dérivé du statut). */
  libelle?: string;
  /** Table de correspondance statut → libellé affiché. */
  libelles?: Record<string, string>;
  className?: string;
}) {
  const tonEffectif = ton ?? map?.[statut] ?? tonAuto(statut);
  return (
    <Badge
      variant={TON_VERS_VARIANT[tonEffectif]}
      className={cn('font-medium', className)}
    >
      {libelle ?? libelles?.[statut] ?? libelleAuto(statut)}
    </Badge>
  );
}
