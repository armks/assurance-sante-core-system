'use client';

import {
  ArrowRight,
  Building2,
  ChevronDown,
  Menu,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { ancrer, MarqueEnTete, type MarqueVitrine } from './marque';

type IdMenu = 'reseau' | 'partenaire' | 'adhesion';

interface ColonneMenu {
  id: IdMenu;
  titre: string;
  description: string;
  icone: LucideIcon;
  liens: { libelle: string; href: string }[];
}

/** Méga menu : les trois entrées ouvrent le même panneau, colonne active en évidence. */
const COLONNES: ColonneMenu[] = [
  {
    id: 'reseau',
    titre: 'Réseau de soins',
    description: 'Établissements de santé et pharmacies conventionnés, et le parcours de l’adhérent.',
    icone: Stethoscope,
    liens: [
      { libelle: 'Trouver un établissement ou une pharmacie', href: '/reseau-de-soins' },
      { libelle: 'Le principe du réseau', href: '/#reseau' },
      { libelle: 'Le parcours anti-fraude', href: '/#services' },
    ],
  },
  {
    id: 'partenaire',
    titre: 'Devenir partenaire',
    description: 'Clinique, centre de santé ou pharmacie : rejoignez le réseau conventionné.',
    icone: Building2,
    liens: [{ libelle: 'Déposer une candidature', href: '/#partenaire' }],
  },
  {
    id: 'adhesion',
    titre: 'Adhésion',
    description: 'Entreprise, collectivité ou mutuelle : couvrez la santé de vos membres.',
    icone: Users,
    liens: [{ libelle: 'Manifester votre intérêt', href: '/#adhesion' }],
  },
];

/**
 * En-tête de la vitrine. Sans props : page principale de la plateforme. Avec
 * `marque` et `racine` : page d'accueil d'une société (/{slug}) — son logo et
 * son nom, liens de section restant sur sa page.
 */
export function EnTeteAccueil({ marque, racine: accueil = '/' }: { marque?: MarqueVitrine; racine?: string } = {}) {
  const [ouvert, setOuvert] = useState<IdMenu | null>(null);
  const idPanneau = useId();
  const racine = useRef<HTMLElement>(null);
  const declencheurs = useRef<Partial<Record<IdMenu, HTMLButtonElement | null>>>({});
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ouvertParSurvol = useRef(false);

  const annulerFermeture = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
  };
  const fermerBientot = () => {
    annulerFermeture();
    minuterie.current = setTimeout(() => setOuvert(null), 450); // fermeture tardive : le menu ne se referme pas au moindre écart de souris
  };

  // Échap ferme et rend le focus au déclencheur ; clic hors de l'en-tête ferme.
  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        declencheurs.current[ouvert]?.focus();
        setOuvert(null);
      }
    };
    const surClic = (e: MouseEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(null);
    };
    document.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', surClic);
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('mousedown', surClic);
    };
  }, [ouvert]);

  useEffect(() => annulerFermeture, []);

  return (
    <header
      ref={racine}
      className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
      onMouseLeave={fermerBientot}
      onMouseEnter={annulerFermeture}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href={accueil} aria-label="Accueil" className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MarqueEnTete marque={marque} />
        </Link>

        <nav aria-label="Navigation principale" className="hidden flex-1 items-center gap-1 lg:flex">
          {COLONNES.map((c) => (
            <button
              key={c.id}
              ref={(el) => {
                declencheurs.current[c.id] = el;
              }}
              type="button"
              aria-expanded={ouvert === c.id}
              aria-controls={idPanneau}
              onClick={() => {
                // Ouvert par le survol juste avant ce clic : le clic confirme
                // l'ouverture au lieu de la refermer aussitôt.
                if (ouvert === c.id && !ouvertParSurvol.current) setOuvert(null);
                else setOuvert(c.id);
                ouvertParSurvol.current = false;
              }}
              onMouseEnter={() => {
                annulerFermeture();
                if (ouvert !== c.id) ouvertParSurvol.current = true;
                setOuvert(c.id);
              }}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                ouvert === c.id ? 'bg-accent text-accent-foreground' : 'text-foreground/80',
              )}
            >
              {c.titre}
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 transition-transform', ouvert === c.id && 'rotate-180')}
              />
            </button>
          ))}
          <a href={ancrer('/#qui-sommes-nous', accueil)} className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Qui sommes-nous
          </a>
          <a href={ancrer('/#contact', accueil)} className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Contact
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Connexion</Link>
          </Button>
          <MenuMobile racine={accueil} />
        </div>
      </div>

      {/* Panneau du méga menu (desktop) : bleu nuit de la vitrine (token `nuit`).
          Contrastes AA : titres/liens blancs ≥ 15:1, descriptions blue-200 ≥ 10,7:1
          (fond ou colonne surlignée), anneau de focus blanc. */}
      <div
        id={idPanneau}
        role="region"
        aria-label="Nos services"
        hidden={!ouvert}
        className="megamenu-panneau absolute inset-x-0 top-full border-b border-white/10 bg-nuit text-white shadow-[0_24px_48px_-24px_hsl(253_40%_10%/0.6)]"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-3 gap-4 px-6 py-8">
          {COLONNES.map((c, rang) => {
            const Icone = c.icone;
            return (
              <div
                key={c.id}
                style={{ animationDelay: `${350 + rang * 250}ms` }}
                className={cn(
                  'megamenu-colonne rounded-2xl p-5 transition-colors duration-500',
                  ouvert === c.id ? 'bg-white/[0.06]' : 'bg-transparent',
                )}
              >
                <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
                  <Icone aria-hidden="true" className="size-5" />
                </span>
                <p className="mt-4 font-display text-base font-semibold text-white">{c.titre}</p>
                <p className="mt-1 text-sm leading-relaxed text-blue-200">{c.description}</p>
                <ul className="mt-4 space-y-1">
                  {c.liens.map((l) => (
                    <li key={l.href}>
                      <a
                        href={ancrer(l.href, accueil)}
                        onClick={() => setOuvert(null)}
                        className="group inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        {l.libelle}
                        <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}

/** Menu mobile (< lg) : panneau latéral, mêmes entrées que le méga menu. */
function MenuMobile({ racine }: { racine: string }) {
  const [ouvert, setOuvert] = useState(false);
  const fermer = () => setOuvert(false);
  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" className="lg:hidden">
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        side="right"
        // Même bleu nuit que le méga menu ; croix de fermeture (dernier bouton) en blanc.
        className="max-w-sm gap-0 overflow-y-auto border-white/10 bg-nuit p-0 text-white [&>button:last-child]:text-white [&>button:last-child]:opacity-90 [&>button:last-child]:focus-visible:ring-white"
        aria-describedby={undefined}
      >
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="text-white">Menu</DialogTitle>
        </DialogHeader>
        <nav aria-label="Navigation mobile" className="space-y-6 px-5 py-5">
          {COLONNES.map((c) => (
            <div key={c.id}>
              <p className="font-display text-sm font-semibold text-white">{c.titre}</p>
              <p className="mt-0.5 text-xs text-blue-200">{c.description}</p>
              <ul className="mt-2 space-y-1">
                {c.liens.map((l) => (
                  <li key={l.href}>
                    <a href={ancrer(l.href, racine)} onClick={fermer} className="block rounded-md py-1.5 text-sm font-medium text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      {l.libelle}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="space-y-1 border-t border-white/10 pt-4">
            <a href={ancrer('/#qui-sommes-nous', racine)} onClick={fermer} className="block rounded-md py-1.5 text-sm font-medium text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Qui sommes-nous
            </a>
            <a href={ancrer('/#contact', racine)} onClick={fermer} className="block rounded-md py-1.5 text-sm font-medium text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              Contact
            </a>
          </div>
          <Button asChild className="w-full">
            <Link href="/login">Connexion</Link>
          </Button>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
