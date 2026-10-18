import { Banknote, BarChart3, Building2, Landmark, Pill, Receipt, Stethoscope, Store, UserSearch, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

interface Rapport {
  titre: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** couleur d'accent (classes complètes pour Tailwind) */
  pastille: string;
}

interface Famille {
  titre: string;
  description: string;
  rapports: Rapport[];
}

/**
 * Centre des rapports de la direction de l'assureur : tous les types de rapport de tous les utilisateurs de la plateforme
 * (assurance, établissements de santé, pharmacies, sociétés clientes, adhérents), chacun avec filtres multicritères et export PDF
 * ou Word.
 */
export function CentreRapports({ racine }: { racine: string }) {
  const familles: Famille[] = [
    {
      titre: 'Assurance',
      description: 'Pilotage de la société d’assurance.',
      rapports: [
        { titre: 'Activité des dossiers de soins', description: 'Dossiers, consultations, actes, coûts et pré-autorisations, par mois, catégorie, médecin, établissement et société.', href: `${racine}/rapports`, icon: BarChart3, pastille: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' },
        { titre: 'Facturation mensuelle', description: 'Factures mensuelles des prestataires : facturé, payé, restant dû, délais de paiement.', href: `${racine}/rapports-facturation`, icon: Receipt, pastille: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
        { titre: 'Cotisations', description: 'Appels de cotisation : dû, encaissé, retards et pénalités, par société et par mois.', href: `${racine}/rapports-cotisations`, icon: Wallet, pastille: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
        { titre: 'Finances', description: 'Soldes des comptes, entrées, sorties et mouvements.', href: `${racine}/rapports-financiers`, icon: Landmark, pastille: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300' },
      ],
    },
    {
      titre: 'Établissements de santé',
      description: 'Activité de chaque centre médical, clinique ou hôpital du réseau.',
      rapports: [
        { titre: 'Activité par établissement', description: 'Choisissez un établissement dans les critères : ses dossiers, actes, médecins et coûts.', href: `${racine}/rapports`, icon: Stethoscope, pastille: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
        { titre: 'Factures mensuelles des établissements', description: 'Facturation de chaque établissement (type « établissements »).', href: `${racine}/rapports-facturation?type=ETABLISSEMENT`, icon: Building2, pastille: 'bg-violet-500/15 text-violet-600 dark:text-violet-300' },
      ],
    },
    {
      titre: 'Pharmacies',
      description: 'Dispensations et facturation des pharmacies du réseau.',
      rapports: [
        { titre: 'Dispensations de pharmacie', description: 'Volumes, montants assurance / patient, médicaments délivrés, anomalies de prix, par pharmacie.', href: `${racine}/rapports-dispensations`, icon: Pill, pastille: 'bg-teal-500/15 text-teal-600 dark:text-teal-300' },
        { titre: 'Factures mensuelles des pharmacies', description: 'Facturation de chaque pharmacie (type « pharmacies »).', href: `${racine}/rapports-facturation?type=PHARMACIE`, icon: Store, pastille: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300' },
      ],
    },
    {
      titre: 'Sociétés clientes',
      description: 'Suivi des entreprises et collectivités assurées.',
      rapports: [
        { titre: 'Cotisations par société', description: 'Choisissez une société dans les critères : ses cotisations, retards et paiements.', href: `${racine}/rapports-cotisations`, icon: Banknote, pastille: 'bg-amber-500/15 text-amber-600 dark:text-amber-300' },
        { titre: 'Activité par société cliente', description: 'Soins consommés par les adhérents d’une société (critère « société cliente »).', href: `${racine}/rapports`, icon: BarChart3, pastille: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' },
      ],
    },
    {
      titre: 'Adhérents',
      description: 'Situation individuelle des assurés.',
      rapports: [
        { titre: 'Relevé de soins d’un adhérent', description: 'Soins et médicaments d’un adhérent et de ses bénéficiaires : pris en charge par l’assurance et reste à charge.', href: `${racine}/releve-adherent`, icon: UserSearch, pastille: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {familles.map((f) => (
        <section key={f.titre} className="space-y-3" aria-labelledby={`famille-${f.titre}`}>
          <div>
            <h2 id={`famille-${f.titre}`} className="text-base font-semibold">
              {f.titre}
            </h2>
            <p className="text-sm text-muted-foreground">{f.description}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {f.rapports.map((r) => (
              <li key={r.titre + r.href}>
                <Link href={r.href} className="group flex h-full gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${r.pastille}`}>
                    <r.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium group-hover:text-primary">{r.titre}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{r.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Chaque rapport propose des filtres multicritères (période, établissement, société, statut…) et l’export en PDF ou en Word.</p>
    </div>
  );
}
