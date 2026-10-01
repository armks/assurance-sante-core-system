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
}: {
  statut: string;
  dateRealisation?: string | null;
}) {
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
