'use client';

import { ExternalLink, ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { modifierHero } from '@/app/dashboard-assureur/informatique/evenements/actions';
import { ChampCheckbox, ChampTexte, ChampZone, FormulaireModal } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Miroir de `GET /api/v1/vitrine/hero`. */
export interface HeroSocieteDonnees {
  heroTitre: string | null;
  heroSousTitre: string | null;
  heroImageUrl: string | null;
  slug: string | null;
}

/** Textes de la première diapositive de la bannière de la plateforme (repli). */
const TITRE_DEFAUT = 'Une seule plateforme pour votre réseau de soins';
const SOUS_TITRE_DEFAUT = 'Établissements de santé conventionnés, adhérents identifiés par leur carte à chaque visite.';

/**
 * Bannière (« hero ») de la page d'accueil de la société (/{slug}) : texte
 * d'accroche, sous-titre, image de fond. Chaque champ laissé vide reprend la
 * valeur par défaut de la plateforme — la bannière n'est jamais vide. Réservé à
 * ASSUREUR_INFORMATIQUE (revérifié par l'API).
 */
export function HeroSociete({ hero }: { hero: HeroSocieteDonnees }) {
  const router = useRouter();
  const personnalise = Boolean(hero.heroTitre || hero.heroSousTitre || hero.heroImageUrl);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Bannière de la page d’accueil</CardTitle>
        <div className="flex flex-wrap gap-2">
          {hero.slug && (
            <Button asChild size="sm" variant="outline">
              <a href={`/${hero.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Voir la page /{hero.slug}
              </a>
            </Button>
          )}
          <FormulaireModal
            titre="Bannière de la page d’accueil"
            description="Laissez un champ vide pour garder le texte ou l’image par défaut de la plateforme."
            declencheurLabel="Modifier la bannière"
            libelleSoumettre="Enregistrer"
            onSoumettre={modifierHero}
            onSucces={() => router.refresh()}
          >
            <ChampTexte
              name="heroTitre"
              label="Texte d’accroche"
              maxLength={120}
              defaultValue={hero.heroTitre ?? ''}
              placeholder={TITRE_DEFAUT}
              aide="120 caractères au plus. Vide : texte par défaut."
            />
            <ChampZone
              name="heroSousTitre"
              label="Sous-titre"
              maxLength={300}
              rows={3}
              defaultValue={hero.heroSousTitre ?? ''}
              placeholder={SOUS_TITRE_DEFAUT}
              aide="300 caractères au plus. Vide : texte par défaut."
            />
            <ChampTexte
              name="image"
              label={hero.heroImageUrl ? 'Nouvelle image de fond' : 'Image de fond'}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aide="JPEG, PNG ou WEBP, 5 Mo au plus. Format paysage large conseillé (1920 × 1080). Un voile sombre est appliqué pour la lisibilité du texte."
            />
            {hero.heroImageUrl && <ChampCheckbox name="supprimerImage" label="Revenir à l’image par défaut" />}
          </FormulaireModal>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative grid h-20 w-36 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
            {hero.heroImageUrl ? (
              <Image src={hero.heroImageUrl} alt="" fill sizes="144px" className="object-cover" />
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ImageIcon aria-hidden="true" className="size-4" />
                Par défaut
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p className="font-medium">{hero.heroTitre ?? TITRE_DEFAUT}</p>
            <p className="text-muted-foreground">{hero.heroSousTitre ?? SOUS_TITRE_DEFAUT}</p>
            <p className="text-xs text-muted-foreground">
              {personnalise
                ? 'Bannière personnalisée (les éléments non renseignés reprennent ceux de la plateforme).'
                : 'Bannière par défaut de la plateforme.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
