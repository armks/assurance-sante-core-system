import { User } from 'lucide-react';

import { cn } from '@/lib/utils';

const TAILLES = {
  sm: { boite: 'size-9', icone: 'size-4' },
  md: { boite: 'size-14', icone: 'size-5' },
  lg: { boite: 'size-20', icone: 'size-7' },
} as const;

/**
 * Photo de profil en médaillon rond (lecture seule). `url` = URL signée courte
 * durée (bucket privé `photos`) ; sans photo, une silhouette neutre — jamais
 * d'image cassée. Réutilisé par `PhotoUploader` pour l'aperçu.
 */
export function Medaillon({
  url,
  nom,
  taille = 'md',
  className,
}: {
  url: string | null;
  /** Nom de la personne : texte alternatif de la photo (vide → « Photo de profil »). */
  nom: string;
  taille?: keyof typeof TAILLES;
  className?: string;
}) {
  const t = TAILLES[taille];
  const texteAlt = nom ? `Photo de ${nom}` : 'Photo de profil';
  return (
    <span
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-full border bg-muted',
        t.boite,
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée Storage, pas d'optimisation Next.js utile
        <img src={url} alt={texteAlt} className="size-full object-cover" />
      ) : (
        <span
          role="img"
          aria-label={nom ? `Pas de photo pour ${nom}` : 'Pas de photo de profil'}
          className="grid size-full place-items-center text-muted-foreground"
        >
          <User aria-hidden="true" className={t.icone} />
        </span>
      )}
    </span>
  );
}
