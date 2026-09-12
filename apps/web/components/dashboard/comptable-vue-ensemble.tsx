import Link from 'next/link';
import { ReceiptText, Wallet } from 'lucide-react';

import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface CotisationResume {
  montantDu: string;
  montantPaye: string;
  statut: string;
}

const INFORMATIQUE = '/dashboard-assureur/informatique';
const montantF = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} F`;

/**
 * Vue d'ensemble partagée `ASSUREUR_COMPTABLE` / `ASSUREUR_COMPTABLE_ADJOINT`.
 * Périmètre vérifié précisément avant construction (voir le commentaire de
 * `ROUTES_ADMIN_ASSUREUR` dans `informatique/layout.tsx` pour le détail des
 * constantes de rôle lues) : seul `Cotisations` (`ROLES_GESTION_BILLING`) est
 * un écran où ce rôle a une écriture réelle. Souscripteurs/Polices/Adhérents/
 * Produits/Réseau : lecture seule (aucun droit d'écriture, mêmes raisons que
 * l'exclusion déjà appliquée à `ASSUREUR_EXPLOITATION`). Réclamations :
 * **aucun accès**, ni lecture ni écriture (`ROLES_LECTURE_CLAIMS` ne
 * l'inclut pas). Utilisateurs : jamais créateur ni validateur dans
 * `regles_provisioning`.
 */
export function ComptableVueEnsemble({
  cotisations,
  peutValider,
}: {
  cotisations: CotisationResume[];
  peutValider: boolean;
}) {
  const actives = cotisations.filter((c) => c.statut !== 'ANNULEE');
  const aPayer = cotisations.filter((c) => c.statut === 'A_PAYER').length;
  const payees = cotisations.filter((c) => c.statut === 'PAYEE').length;
  const enRetard = cotisations.filter((c) => c.statut === 'EN_RETARD').length;
  const resteAEncaisser = actives.reduce(
    (s, c) => s + (Number(c.montantDu) - Number(c.montantPaye)),
    0,
  );

  return (
    <div className="space-y-8">
      <GrilleCartes>
        <CarteResume
          libelle="À payer"
          valeur={aPayer}
          icon={Wallet}
          href={`${INFORMATIQUE}/cotisations`}
        />
        <CarteResume
          libelle="Payées"
          valeur={payees}
          tonIndice="positif"
          href={`${INFORMATIQUE}/cotisations`}
        />
        <CarteResume
          libelle="En retard"
          valeur={enRetard}
          tonIndice={enRetard > 0 ? 'negatif' : 'neutre'}
          href={`${INFORMATIQUE}/cotisations`}
        />
        <CarteResume libelle="Reste à encaisser" valeur={montantF(resteAEncaisser)} />
      </GrilleCartes>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Accès rapides</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href={`${INFORMATIQUE}/cotisations`} className="group block">
            <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                    <Wallet className="size-4" />
                  </span>
                  <CardTitle className="text-base">Cotisations</CardTitle>
                </div>
                <CardDescription className="pt-1">
                  Appels de cotisation, grilles tarifaires et enregistrement des paiements.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </section>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="size-4 text-muted-foreground" />
            Périmètre de ce rôle — vérifié avant construction de cet écran
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Réclamations non accessibles</strong> à ce rôle
            (vérifié : contrairement à l’exploitation, `ASSUREUR_COMPTABLE` ne figure ni dans les
            rôles de gestion ni dans les rôles de lecture des réclamations).
          </p>
          <p>
            <strong className="text-foreground">Confirmation de paiement des factures</strong>{' '}
            d’établissement (v8 §5) : droit API réel et exclusif à ce rôle, mais aucun écran
            n’existe encore pour ce domaine côté assureur — gap documenté, non construit ici
            (hors périmètre : accès aux écrans déjà existants uniquement).
          </p>
          <p>
            <strong className="text-foreground">Rapports financiers</strong> : aucun module de
            reporting n’existe aujourd’hui dans l’API — rien à lier.
          </p>
          {!peutValider && (
            <p>
              <strong className="text-foreground">Rôle adjoint</strong> : aucune action du
              périmètre Cotisations n’a de notion de « validation finale » à ce jour (vérifié) —
              rien n’est donc masqué sur cet écran, contrairement à l’espace informatique-adjoint.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
