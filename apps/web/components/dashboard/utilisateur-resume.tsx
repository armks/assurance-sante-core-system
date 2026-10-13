import Link from 'next/link';

import { cn } from '@/lib/utils';

/** Ce qui identifie l'utilisateur dans l'interface : qui il est, son rôle, la structure à laquelle il appartient. */
export interface UtilisateurResume {
  email: string;
  pseudo: string | null;
  aPhoto: boolean;
  libelleRole: string | null;
  /** Établissement, pharmacie, société ou — à défaut — organisation d'appartenance. */
  structure: string | null;
  /** Type de la structure, pour l'étiquette (« Établissement de santé »…). */
  typeStructure: string | null;
}

/** Données d'identité du profil → résumé d'affichage (structure la plus précise d'abord). */
export function resumeUtilisateur(
  profil: {
    email?: string | null;
    pseudo?: string | null;
    aPhoto?: boolean;
    libelleRole?: string | null;
    organisationNom?: string | null;
    etablissementNom?: string | null;
    pharmacieNom?: string | null;
    societeNom?: string | null;
  },
  email: string,
): UtilisateurResume {
  const structure = profil.etablissementNom
    ? { nom: profil.etablissementNom, type: 'Établissement de santé' }
    : profil.pharmacieNom
      ? { nom: profil.pharmacieNom, type: 'Pharmacie' }
      : profil.societeNom
        ? { nom: profil.societeNom, type: 'Société souscriptrice' }
        : profil.organisationNom
          ? { nom: profil.organisationNom, type: 'Société d’assurance' }
          : null;
  return {
    email,
    pseudo: profil.pseudo ?? null,
    aPhoto: profil.aPhoto ?? false,
    libelleRole: profil.libelleRole ?? null,
    structure: structure?.nom ?? null,
    typeStructure: structure?.type ?? null,
  };
}

export function nomAffiche(u: UtilisateurResume): string {
  return u.pseudo || u.email.split('@')[0];
}

function initiales(u: UtilisateurResume): string {
  const base = nomAffiche(u).replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const mots = base.split(/\s+/).filter(Boolean);
  return ((mots[0]?.[0] ?? '?') + (mots.length > 1 ? mots[1][0] : '')).toUpperCase();
}

/** Photo de l'utilisateur (servie par `/profil/photo`, qui redirige vers l'URL signée) ou ses initiales. */
export function AvatarUtilisateur({ utilisateur, taille = 'md', cle }: { utilisateur: UtilisateurResume; taille?: 'sm' | 'md' | 'lg'; cle?: number }) {
  const classe = taille === 'lg' ? 'size-20 text-xl' : taille === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm';
  if (utilisateur.aPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL signée résolue côté serveur, hors optimiseur d'images
      <img
        src={`/profil/photo${cle ? `?v=${cle}` : ''}`}
        alt={`Photo de ${nomAffiche(utilisateur)}`}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-border', classe)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ring-1 ring-border', classe)}
    >
      {initiales(utilisateur)}
    </span>
  );
}

/** Carte d'identité compacte (barre latérale, panneau mobile) — lien vers « Mon profil ». */
export function CarteUtilisateur({ utilisateur }: { utilisateur: UtilisateurResume }) {
  return (
    <Link href="/profil" className="flex items-center gap-3 rounded-md outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring" title="Mon profil">
      <AvatarUtilisateur utilisateur={utilisateur} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight">{nomAffiche(utilisateur)}</span>
        {utilisateur.pseudo && <span className="block truncate text-xs text-muted-foreground">{utilisateur.email}</span>}
        {utilisateur.structure && (
          <span className="block truncate text-xs text-muted-foreground" title={utilisateur.typeStructure ?? undefined}>
            {utilisateur.structure}
          </span>
        )}
      </span>
    </Link>
  );
}
