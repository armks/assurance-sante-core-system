import Link from 'next/link';
import {
  Building2,
  FileText,
  HeartPulse,
  Package,
  Pill,
  Wallet,
} from 'lucide-react';

import { PageTitre } from '@/components/page-titre';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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
    href: `${RACINE}/pharmacies`,
    icon: Pill,
    titre: 'Pharmacies',
    desc: 'Officines conventionnées du réseau.',
  },
];

export default function VueEnsemble() {
  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Assurance Informatique. Sélectionnez une section pour commencer."
      />

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
