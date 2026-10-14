import { Building2, Pill } from 'lucide-react';

import type { PartenairePublic } from '@/lib/partenaires-publics';

const EMPLACEMENTS = [Building2, Pill, Building2, Pill, Building2, Pill];

/**
 * Cadre UNIQUE de tous les logos : 12 × 4 rem (3:1, comme le format homologué 480 × 160 px des logos enregistrés par l'API) — tous les logos ont
 * donc la même taille et le même alignement dans le bandeau, quel que soit le fichier d'origine.
 */
const CADRE = 'block h-16 w-48 shrink-0';

/** Un logo du bandeau : lien vers le site du partenaire s'il en a un (ouvert dans un nouvel onglet, sans transmettre l'origine). */
function Logo({ p, decoratif }: { p: PartenairePublic; decoratif?: boolean }) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- logos hébergés dans le stockage public, dimensions variables
    <img
      src={p.logoUrl}
      alt={decoratif ? '' : p.nom}
      loading="lazy"
      className="h-full w-full object-contain opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0"
    />
  );
  return p.siteUrl && !decoratif ? (
    <a href={p.siteUrl} target="_blank" rel="noopener noreferrer" title={p.nom} className={`${CADRE} rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
      {image}
    </a>
  ) : (
    <span className={CADRE} title={decoratif ? undefined : p.nom}>
      {image}
    </span>
  );
}

/**
 * Bandeau défilant des logos partenaires, JUSTE APRÈS la bannière d'en-tête (seul élément en défilement continu de la page). Les logos sont
 * ceux que la société a ajoutés (écran « Logos partenaires » de son informaticien) ; défilement suspendu au survol, statique si l'utilisateur
 * réduit les animations. Sans logo : sur la page d'une société le bandeau n'est pas affiché ; sur la page principale, des emplacements neutres.
 *
 * Le défilement est continu quel que soit le nombre de logos : la série est répétée jusqu'à couvrir au moins deux largeurs d'écran, puis
 * doublée (la seconde moitié prend le relais, boucle sans saut) ; la durée du tour s'allonge avec le nombre de logos pour garder une vitesse
 * lente et régulière.
 */
export function BandeauPartenaires({ partenaires = [], societe = false }: { partenaires?: PartenairePublic[]; societe?: boolean }) {
  const avecLogos = partenaires.length > 0;
  if (!avecLogos && societe) return null;

  const repetitions = avecLogos ? Math.max(1, Math.ceil(14 / partenaires.length)) : 1;
  const moitie = avecLogos
    ? Array.from({ length: repetitions }, (_, r) => partenaires.map((p) => ({ p, cle: `${r}-${p.id}` }))).flat()
    : [];
  // ≈ 4,5 s par logo affiché : vitesse lente et constante, du plus petit au plus grand nombre de logos
  const duree = Math.max(30, moitie.length * 4.5);

  const elements = avecLogos
    ? moitie.map(({ p, cle }) => <Logo key={cle} p={p} decoratif={cle.split('-')[0] !== '0'} />)
    : EMPLACEMENTS.map((Icone, i) => (
        <span key={i} aria-hidden="true" className="grid h-12 w-40 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground/60">
          <Icone className="size-5" />
        </span>
      ));

  return (
    <section aria-label="Nos partenaires" className="border-b bg-background py-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="text-center text-sm text-muted-foreground">
          {avecLogos ? 'Nos partenaires' : 'Les établissements de santé et pharmacies partenaires seront présentés ici.'}
        </p>
      </div>
      <div className="relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        {/* Liste doublée : la seconde moitié prend le relais, boucle sans saut. */}
        <div className="accueil-defilement flex w-max items-center gap-10 px-5" style={avecLogos ? { animationDuration: `${duree}s` } : undefined}>
          {elements}
          <div aria-hidden="true" className="flex items-center gap-10">
            {avecLogos ? moitie.map(({ p, cle }) => <Logo key={`bis-${cle}`} p={p} decoratif />) : elements}
          </div>
        </div>
      </div>
    </section>
  );
}
