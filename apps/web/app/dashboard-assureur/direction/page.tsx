import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Building2,
  FileText,
  Package,
  ReceiptText,
  Users,
} from 'lucide-react';

import { GraphiquesSoinsServeur } from '@/components/dashboard/exploitation/graphiques-soins-serveur';
import { CarteResume, GrilleCartes } from '@/components/dashboard/patterns';
import { PageTitre } from '@/components/page-titre';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Vue d’ensemble — Direction' };

const INFORMATIQUE = '/dashboard-assureur/informatique';

/** Écrans de gestion existants que l'API autorise déjà pour ASSUREUR_DIRECTION. */
const RACCOURCIS = [
  {
    titre: 'Souscripteurs',
    href: `${INFORMATIQUE}/souscripteurs`,
    icon: Building2,
    description: 'Entreprises et collectivités assurées, comités de gestion.',
  },
  {
    titre: 'Produits',
    href: `${INFORMATIQUE}/produits`,
    icon: Package,
    description: 'Gammes, garanties et versions du catalogue de produits.',
  },
  {
    titre: 'Polices',
    href: `${INFORMATIQUE}/polices`,
    icon: FileText,
    description: 'Contrats, souscription, avenants et cycle de vie des polices.',
  },
  {
    titre: 'Adhérents',
    href: `${INFORMATIQUE}/adherents`,
    icon: Users,
    description: 'Souscripteurs individuels, bénéficiaires et cartes.',
  },
  {
    titre: 'Réclamations',
    href: `${INFORMATIQUE}/reclamations`,
    icon: ReceiptText,
    description:
      'Suivi de l’adjudication et revue manuelle (la supervision est ouverte à la direction).',
  },
  {
    titre: 'Utilisateurs',
    href: `${INFORMATIQUE}/utilisateurs`,
    icon: Users,
    description: 'Comptes de l’organisation et invitations.',
  },
] as const;

interface Compte {
  id: string;
}
interface Police {
  id: string;
  statut: string;
}
interface Reclamation {
  statut: string;
  remboursement: { montantRembourse: string } | null;
}
interface Cotisation {
  montantPaye: string;
  statut: string;
}

async function jsonOuVide<T>(chemin: string): Promise<T[]> {
  const res = await apiFetch(chemin);
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

const montantF = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} F`;

export default async function DirectionAccueil() {
  const [comptes, policesActives, reclamations, cotisations] = await Promise.all([
    jsonOuVide<Compte>('/api/v1/identity/comptes'),
    jsonOuVide<Police>('/api/v1/policy/polices?statut=ACTIVE'),
    jsonOuVide<Reclamation>('/api/v1/claims/reclamations'),
    jsonOuVide<Cotisation>('/api/v1/billing/cotisations'),
  ]);

  const enRevue = reclamations.filter(
    (r) => r.statut === 'REVUE_MANUELLE',
  ).length;

  const totalRembourse = reclamations.reduce(
    (s, r) => s + Number(r.remboursement?.montantRembourse ?? 0),
    0,
  );
  const totalEncaisse = cotisations.reduce(
    (s, c) => s + Number(c.montantPaye ?? 0),
    0,
  );
  const sinistralite =
    totalEncaisse > 0
      ? `${((totalRembourse / totalEncaisse) * 100).toFixed(1)} %`
      : '—';

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Vue d’ensemble"
        description="Espace Direction — pilotage de l’activité de l’organisation. Vous partagez les écrans de gestion de l’assureur ; la facturation et le réseau de soins restent gérés par l’informatique."
      />

      <GrilleCartes>
        <CarteResume
          libelle="Comptes provisionnés"
          valeur={comptes.length}
          icon={Users}
          href={`${INFORMATIQUE}/utilisateurs`}
        />
        <CarteResume
          libelle="Polices actives"
          valeur={policesActives.length}
          icon={FileText}
          href={`${INFORMATIQUE}/polices`}
        />
        <CarteResume
          libelle="Réclamations en attente de revue"
          valeur={enRevue}
          icon={ReceiptText}
          href={`${INFORMATIQUE}/reclamations/revue-manuelle`}
        />
        <CarteResume
          libelle="Sinistralité globale"
          valeur={sinistralite}
          indice={
            totalEncaisse > 0
              ? `${montantF(totalRembourse)} remboursés / ${montantF(totalEncaisse)} encaissés`
              : 'Aucune cotisation encaissée pour l’instant'
          }
        />
      </GrilleCartes>

      <GraphiquesSoinsServeur />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Accès rapides
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RACCOURCIS.map((r) => {
            const Icon = r.icon;
            return (
              <Link key={r.href} href={r.href} className="group block">
                <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/40">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-lg border bg-background text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <CardTitle className="text-base">{r.titre}</CardTitle>
                    </div>
                    <CardDescription className="pt-1">
                      {r.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
