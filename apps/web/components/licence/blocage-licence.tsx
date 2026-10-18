import { KeyRound, ShieldAlert } from 'lucide-react';

import { Brand } from '@/components/brand';
import { EcranMessage } from '@/components/ecran-message';
import { FormulaireActivation } from '@/components/licence/formulaire-activation';
import { LogoutButton } from '@/components/logout-button';
import type { IdentityMeProvisionne } from '@/lib/identity';

const ROLES_ACTIVATION = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'];

const dateFr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

/**
 * Écran affiché à la place de l'application quand la licence de la société n'est pas active (expirée, non activée, suspendue,
 * absente). L'informatique et la direction de l'assureur voient la fenêtre d'activation (saisie du code temporaire transmis par le
 * superadmin) ; les autres comptes sont informés et invités à contacter leur administrateur. Retourne null si la licence est active.
 */
export function blocageLicence(identity: IdentityMeProvisionne): React.ReactNode | null {
  const licence = identity.licence;
  if (!licence || licence.etat === 'ACTIVE') return null;
  const peutActiver = identity.permissions.roleChain.some((r) => ROLES_ACTIVATION.includes(r));
  const organisation = identity.profil.organisationNom ?? 'votre société';

  const raison =
    licence.etat === 'EXPIREE'
      ? `La licence de ${organisation} a expiré le ${dateFr(licence.dateFin)}.`
      : licence.etat === 'EN_ATTENTE_ACTIVATION'
        ? `La licence de ${organisation} attend son activation.`
        : licence.etat === 'SUSPENDUE'
          ? `La licence de ${organisation} est suspendue.`
          : `Aucune licence n’est associée à ${organisation}.`;

  if (licence.etat === 'SUSPENDUE' || !peutActiver) {
    return (
      <EcranMessage
        tonalite="attention"
        titre="Accès suspendu : licence non active"
        description={`${raison} ${peutActiver ? 'Contactez le support de la plateforme.' : 'Contactez l’administrateur de votre société (informatique ou direction).'}`}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-background/95 px-4 py-8 backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="titre-activation">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex justify-center">
          <Brand size="lg" />
        </div>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <ShieldAlert className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 id="titre-activation" className="text-lg font-semibold">
              Activation de la licence
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{raison}</p>
          </div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" aria-hidden="true" /> En attente de la clé d’activation
          </p>
          <p className="mt-1 text-muted-foreground">
            Le support de la plateforme vous transmet une clé temporaire. Saisissez-la ci-dessous pour rétablir l’accès de toute votre société. Sans activation dans les 24 h suivant
            son émission, la clé expire et il faut en demander une nouvelle.
          </p>
        </div>
        <FormulaireActivation />
        <div className="flex justify-end border-t pt-3">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
