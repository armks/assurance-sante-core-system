import { StatutBadge } from '@/components/dashboard/patterns';
import { LIBELLE_STATUT_ACTE, TON_STATUT_ACTE } from '@/lib/centre-medical';

/**
 * Statut d'un acte — « Prescrit — non réalisé » (ambre, non facturable) ou
 * « Réalisé » (vert) avec sa date de réalisation. Partagé par toutes les
 * listes d'actes de l'établissement (médecin, comptable, facture mensuelle).
 */
export function StatutActe({
  statut,
  dateRealisation,
  surUneLigne = false,
}: {
  statut: string;
  dateRealisation?: string | null;
  /** Badge seul (date en infobulle) pour les tableaux resserrés, au lieu de badge + date empilés. */
  surUneLigne?: boolean;
}) {
  const date = dateRealisation
    ? new Date(dateRealisation).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  if (surUneLigne) {
    // tableau resserré : la date de réalisation passe en infobulle pour garder le badge seul sur la ligne
    return (
      <span className="inline-flex whitespace-nowrap" title={date ? `Réalisé le ${date}` : undefined}>
        <StatutBadge statut={statut} map={TON_STATUT_ACTE} libelles={LIBELLE_STATUT_ACTE} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatutBadge statut={statut} map={TON_STATUT_ACTE} libelles={LIBELLE_STATUT_ACTE} />
      {dateRealisation && (
        <span className="text-xs text-muted-foreground">
          le{' '}
          {new Date(dateRealisation).toLocaleString('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
      )}
    </span>
  );
}
