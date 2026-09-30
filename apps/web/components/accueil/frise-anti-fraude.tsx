'use client';

import { useEffect, useRef, useState } from 'react';

import type { CleStatistique, StatistiquesPubliques } from '@/lib/statistiques-publiques';
import { cn } from '@/lib/utils';

const ETAPES: { libelle: string; cle: CleStatistique; legende: string }[] = [
  { libelle: 'Consultation', cle: 'codesConsultation', legende: 'codes de consultation émis' },
  { libelle: 'Ordonnance', cle: 'ordonnancesTraitees', legende: 'ordonnances délivrées' },
  { libelle: 'Ticket de soins', cle: 'ticketsSoins', legende: 'tickets de soins ouverts' },
  { libelle: 'Facturation', cle: 'facturesReglees', legende: 'factures réglées' },
];

/** Décalage entre deux étapes (apparition successive). */
const PAS_MS = 220;
const DUREE_COMPTEUR_MS = 1200;

const nombre = (n: number) => n.toLocaleString('fr-FR');

/** « de la plateforme », « de Mutuelle X », « d’Assureur Y » (élision devant une voyelle). */
const de = (nom: string) => (/^[aeiouyàâäéèêëîïôöûùüœ]/i.test(nom) ? `d’${nom}` : `de ${nom}`);

/**
 * Compteur « plus de N » : défile de 0 à N au lancement. Écrit directement le
 * texte du nœud dans requestAnimationFrame (aucun état React par image).
 */
function CompteurAnime({ valeur, lance, delaiMs }: { valeur: number; lance: boolean; delaiMs: number }) {
  const noeud = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = noeud.current;
    if (!el) return;
    if (!lance) {
      el.textContent = nombre(valeur);
      return;
    }
    el.textContent = '0';
    let image = 0;
    let debut = 0;
    const pas = (t: number) => {
      if (!debut) debut = t + delaiMs;
      const p = Math.min(1, Math.max(0, (t - debut) / DUREE_COMPTEUR_MS));
      el.textContent = nombre(Math.round(valeur * (1 - (1 - p) ** 3)));
      if (p < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [valeur, lance, delaiMs]);
  return <span ref={noeud}>{nombre(valeur)}</span>;
}

const dateLongue = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Frise des quatre codes du parcours anti-fraude, avec les statistiques
 * publiques de la plateforme sous chaque étape. Horizontale à partir de md,
 * empilée verticalement en dessous. Chaque étape apparaît l'une après l'autre
 * quand la frise entre dans l'écran (un seul IntersectionObserver, déclenché une
 * fois : aucun écouteur de défilement).
 *
 * Sans JavaScript, ou avec « réduire les animations », tout est affiché
 * d'emblée : l'état masqué n'est appliqué qu'une fois le composant monté et
 * l'animation autorisée.
 *
 * Statistiques : arrondies et arrêtées la veille par l'API ; un compteur sous
 * le seuil arrive `null` et n'est pas affiché (aucun chiffre côté navigateur).
 */
export function FriseAntiFraude({
  statistiques,
  perimetre = 'la plateforme',
}: {
  statistiques?: StatistiquesPubliques | null;
  /** « la plateforme » (page principale) ou le nom de la société (page /{slug}). */
  perimetre?: string;
}) {
  const racine = useRef<HTMLOListElement>(null);
  const [etat, setEtat] = useState<'statique' | 'attente' | 'visible'>('statique');

  useEffect(() => {
    const el = racine.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      return;
    }
    setEtat('attente');
    const obs = new IntersectionObserver(
      ([entree]) => {
        if (entree.isIntersecting) {
          setEtat('visible');
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const masque = etat === 'attente';
  const anime = etat === 'visible';
  const compteurs = statistiques?.compteurs;
  const auMoinsUn = compteurs ? Object.values(compteurs).some((v) => v !== null) : false;

  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8 md:p-10">
      <h3 className="text-center font-display text-lg font-semibold md:text-xl">Le parcours, étape par étape</h3>
      <ol
        ref={racine}
        aria-label="Les quatre codes du parcours anti-fraude"
        className="mx-auto mt-8 flex max-w-4xl flex-col items-center md:grid md:grid-cols-4 md:items-start"
      >
        {ETAPES.map(({ libelle, cle, legende }, i) => {
          const dernier = i === ETAPES.length - 1;
          const delai = { animationDelay: `${i * PAS_MS}ms` };
          const delaiTrait = { animationDelay: `${i * PAS_MS + PAS_MS / 2}ms` };
          const valeur = compteurs?.[cle] ?? null;
          return (
            <li key={cle} className="relative flex flex-col items-center text-center">
              <span
                className={cn(
                  'relative z-10 grid size-14 place-items-center rounded-full bg-primary font-display text-xl font-semibold text-primary-foreground shadow-[0_8px_24px_-8px_hsl(253_78%_62%/0.6)] ring-8 ring-accent',
                  masque && 'opacity-0',
                  anime && 'accueil-etape',
                )}
                style={anime ? delai : undefined}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span
                className={cn('mt-4 font-display text-base font-semibold', masque && 'opacity-0', anime && 'accueil-etape')}
                style={anime ? delai : undefined}
              >
                <span className="sr-only">Étape {i + 1} : </span>
                {libelle}
              </span>
              {valeur !== null && (
                <span
                  className={cn('mt-2 flex flex-col items-center', masque && 'opacity-0', anime && 'accueil-etape')}
                  style={anime ? delai : undefined}
                >
                  <span className="font-display text-2xl font-semibold tabular-nums text-primary">
                    <span className="text-base font-medium text-muted-foreground">plus de </span>
                    <CompteurAnime valeur={valeur} lance={anime} delaiMs={i * PAS_MS} />
                  </span>
                  <span className="max-w-[20ch] text-xs leading-snug text-muted-foreground">{legende}</span>
                </span>
              )}

              {!dernier && (
                <>
                  {/* Liaison horizontale (md+) : du bord du cercle au suivant, avec pointe de flèche. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute left-[calc(50%+2.75rem)] right-[calc(-50%+2.75rem)] top-7 hidden h-0.5 origin-left -translate-y-1/2 bg-primary/60 md:block',
                      "after:absolute after:-right-0.5 after:top-1/2 after:size-2 after:-translate-y-1/2 after:rotate-45 after:border-r-2 after:border-t-2 after:border-primary/60 after:content-['']",
                      masque && 'scale-x-0',
                      anime && 'accueil-trait-x',
                    )}
                    style={anime ? delaiTrait : undefined}
                  />
                  {/* Liaison verticale (mobile) sous le libellé. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative my-3 block h-10 w-0.5 origin-top bg-primary/60 md:hidden',
                      "after:absolute after:-bottom-0.5 after:left-1/2 after:size-2 after:-translate-x-1/2 after:rotate-[135deg] after:border-r-2 after:border-t-2 after:border-primary/60 after:content-['']",
                      masque && 'scale-y-0',
                      anime && 'accueil-trait-y',
                    )}
                    style={anime ? delaiTrait : undefined}
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>

      {statistiques && (
        <p className="mx-auto mt-8 max-w-[60ch] text-center text-xs leading-relaxed text-muted-foreground">
          {auMoinsUn
            ? `Chiffres ${de(perimetre)} arrêtés au ${dateLongue(statistiques.arreteAu)}, arrondis à la baisse. Un chiffre n’est publié qu’au-delà de ${nombre(statistiques.seuilMinimum)}.`
            : `Les chiffres d’activité ${de(perimetre)} seront publiés ici dès que le volume le permettra.`}
        </p>
      )}
    </div>
  );
}
