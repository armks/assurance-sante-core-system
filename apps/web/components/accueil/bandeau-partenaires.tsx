import { Building2, Pill } from 'lucide-react';

/**
 * PARTENAIRES-PLACEHOLDER — liste des logos partenaires. Vide pour l'instant :
 * des emplacements neutres défilent à la place. Pour ajouter un partenaire,
 * déposer son logo dans `public/images/partenaires/` et l'ajouter ici. Aucune
 * gestion dynamique (Super Admin) n'est prévue à ce stade.
 */
const PARTENAIRES: { nom: string; logo: string }[] = [];

const EMPLACEMENTS = [Building2, Pill, Building2, Pill, Building2, Pill];

/** Bandeau défilant de logos partenaires (seul élément en défilement continu
 * de la page). Suspendu au survol ; statique si « réduire les animations ». */
export function BandeauPartenaires() {
  const elements =
    PARTENAIRES.length > 0
      ? PARTENAIRES.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- logos statiques légers
          <img key={p.nom} src={p.logo} alt={p.nom} className="h-10 w-auto opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0" />
        ))
      : EMPLACEMENTS.map((Icone, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="grid h-12 w-40 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground/60"
          >
            <Icone className="size-5" />
          </span>
        ));

  return (
    <section aria-label="Nos partenaires" className="border-b bg-background py-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">
          {PARTENAIRES.length > 0
            ? 'Établissements de santé et pharmacies du réseau'
            : 'Les établissements de santé et pharmacies partenaires seront présentés ici.'}
        </p>
      </div>
      <div className="relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        {/* Liste doublée : la seconde moitié prend le relais, boucle sans saut. */}
        <div className="accueil-defilement flex w-max gap-10 px-5">
          {elements}
          <div aria-hidden="true" className="flex gap-10">
            {elements}
          </div>
        </div>
      </div>
    </section>
  );
}
