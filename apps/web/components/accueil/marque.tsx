import Image from 'next/image';

import { Brand } from '@/components/brand';

/** Identité affichée sur une page d'accueil de société (/{slug}). */
export interface MarqueVitrine {
  nom: string;
  logoUrl: string | null;
}

/**
 * Ancre d'une section de la page : `/#contact` sur la page principale,
 * `/{slug}#contact` sur la page d'une société (les liens restent sur sa page).
 */
export function ancrer(href: string, racine: string): string {
  return racine !== '/' && href.startsWith('/#') ? `${racine}${href.slice(1)}` : href;
}

const initiales = (nom: string) =>
  nom
    .split(/\s+/)
    .filter((m) => /^[\p{L}\p{N}]/u.test(m))
    .slice(0, 2)
    .map((m) => m[0]!.toUpperCase())
    .join('') || '·';

/**
 * Marque de l'en-tête : celle de la plateforme par défaut (page principale,
 * inchangée), sinon le logo et le nom de la société ; sans logo, ses initiales
 * dans le même carré que la marque de la plateforme.
 */
export function MarqueEnTete({ marque }: { marque?: MarqueVitrine }) {
  if (!marque) return <Brand />;
  return (
    <span className="flex items-center gap-2.5">
      {marque.logoUrl ? (
        <Image
          src={marque.logoUrl}
          alt=""
          width={160}
          height={48}
          className="h-9 w-auto max-w-[140px] object-contain"
          priority
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        >
          {initiales(marque.nom)}
        </span>
      )}
      <span className="max-w-[16ch] text-sm font-semibold leading-tight sm:max-w-none">{marque.nom}</span>
    </span>
  );
}
