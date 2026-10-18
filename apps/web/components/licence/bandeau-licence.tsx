import { AlarmClock } from 'lucide-react';
import Link from 'next/link';

import type { EtatLicenceWeb } from '@/lib/identity';

const ROLES_VISIBLES = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'];
const dateFr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Bandeau d'échéance proche (≤ 30 jours) affiché à l'informatique et à la direction de l'assureur, avec la date d'expiration et
 * le temps restant. Rien pour les autres profils ni quand l'échéance est lointaine.
 */
export function BandeauLicence({ licence, roleChain, lien }: { licence: EtatLicenceWeb | null | undefined; roleChain: string[]; lien: string | null }) {
  if (!licence || !licence.bientotExpiree || !roleChain.some((r) => ROLES_VISIBLES.includes(r))) return null;
  const j = licence.joursRestants ?? 0;
  const urgent = j <= 7;
  return (
    <div
      role="status"
      className={`mb-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${urgent ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-amber-300/70 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'}`}
    >
      <AlarmClock className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">
        Votre licence expire le <strong>{dateFr(licence.dateFin)}</strong> — {j === 0 ? 'dernier jour' : `${j} jour${j > 1 ? 's' : ''} restant${j > 1 ? 's' : ''}`}. Demandez un code d’activation pour la renouveler.
      </span>
      {lien && (
        <Link href={lien} className="font-medium underline underline-offset-2">
          Voir la licence
        </Link>
      )}
    </div>
  );
}
