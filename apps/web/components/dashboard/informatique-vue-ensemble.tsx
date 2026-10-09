import Link from 'next/link';
import {
  Building2,
  FileSignature,
  FileText,
  HeartPulse,
  Package,
  Pill,
  Wallet,
} from 'lucide-react';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

const RACINE = '/dashboard-assureur/informatique';

const SECTIONS = [
  {
    href: `${RACINE}/souscripteurs`,
    icon: Building2,
    titre: 'Souscripteurs',
    desc: 'Entreprises, collectivités et souscripteurs individuels affiliés.',
  },
  {
    href: `${RACINE}/produits`,
    icon: Package,
    titre: 'Produits',
    desc: 'Formules d’assurance versionnées et leurs garanties.',
  },
  {
    href: `${RACINE}/polices`,
    icon: FileText,
    titre: 'Polices',
    desc: 'Contrats, cycle de vie et avenants.',
  },
  {
    href: `${RACINE}/cotisations`,
    icon: Wallet,
    titre: 'Cotisations',
    desc: 'Grilles tarifaires, appels de cotisation et paiements.',
  },
  {
    href: `${RACINE}/etablissements`,
    icon: HeartPulse,
    titre: 'Établissements',
    desc: 'Réseau de soins conventionné et recherche géolocalisée.',
  },
  {
    href: `${RACINE}/conventions`,
    icon: FileSignature,
    titre: 'Conventions',
    desc: 'Valeurs négociées par établissement : saisie, validation et nouvelles versions.',
  },
  {
    href: `${RACINE}/pharmacies`,
    icon: Pill,
    titre: 'Pharmacies',
    desc: 'Officines conventionnées du réseau.',
  },
];

/**
 * Vue d'ensemble de l'espace Assurance Informatique — partagée par le titulaire
 * (`/dashboard-assureur/informatique`) et l'adjoint
 * (`/dashboard-assureur/informatique-adjoint`).
 */
export async function InformatiqueVueEnsemble({ adjoint = false }: { adjoint?: boolean }) {
  // indicateur : établissements actifs sans convention validée en vigueur (jamais bloquant pour l'écran)
  let indicateurs: { sansConventionValidee: number; etablissementsActifs: number; conventionsAValider: number } | null = null;
  try {
    const res = await apiFetch('/api/v1/conventions/indicateurs');
    if (res.ok) indicateurs = await res.json();
  } catch {
    indicateurs = null;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {indicateurs && (
        <Link href={`${RACINE}/conventions`} className="group sm:col-span-2" data-testid="indicateur-sans-convention">
          <Card
            className={`transition-colors group-hover:bg-accent/40 ${indicateurs.sansConventionValidee > 0 ? 'border-amber-400' : ''}`}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <FileSignature className="size-4" />
                </span>
                <CardTitle className="text-base">
                  {indicateurs.sansConventionValidee} établissement{indicateurs.sansConventionValidee > 1 ? 's' : ''} sans convention validée
                </CardTitle>
              </div>
              <CardDescription className="pt-1">
                Sur {indicateurs.etablissementsActifs} établissement{indicateurs.etablissementsActifs > 1 ? 's' : ''} actif
                {indicateurs.etablissementsActifs > 1 ? 's' : ''} ; {indicateurs.conventionsAValider} convention
                {indicateurs.conventionsAValider > 1 ? 's' : ''} en attente de validation.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      )}
      {SECTIONS.map(({ href, icon: Icon, titre, desc }) => (
        <Link key={href} href={href} className="group">
          <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <CardTitle className="text-base">{titre}</CardTitle>
              </div>
              <CardDescription className="pt-1">{desc}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
      {adjoint && (
        <p className="sm:col-span-2 text-xs text-muted-foreground">
          Rôle adjoint : vous accédez aux mêmes écrans que l’Assurance
          Informatique. Les actions de validation finale (valider ou rejeter une
          proposition de compte, publier un produit) sont réservées au titulaire.
        </p>
      )}
    </div>
  );
}
