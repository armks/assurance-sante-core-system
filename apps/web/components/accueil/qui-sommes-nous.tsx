import { MapPin, ShieldCheck, Workflow } from 'lucide-react';
import Image from 'next/image';

import type { EvenementPublic } from '@/lib/evenements-publics';

import { CarrouselEvenements } from './carrousel-evenements';
import { PHOTOS } from './photos';

const REPERES = [
  { icone: MapPin, titre: 'Pensé pour la Côte d’Ivoire', texte: 'Montants en francs CFA, réseau de soins local.' },
  { icone: ShieldCheck, titre: 'Pour assureurs et mutuelles', texte: 'Chaque organisation dispose de son espace cloisonné.' },
  { icone: Workflow, titre: 'Du devis au remboursement', texte: 'Souscription, soins, facturation et paiement suivis au même endroit.' },
];

/**
 * « Qui sommes-nous ». La colonne visuelle affiche le carrousel des événements
 * publiés (même place, même format 4:3) ; sans événement, l'image habituelle.
 */
export function QuiSommesNous({ evenements = [] }: { evenements?: EvenementPublic[] }) {
  return (
    <section id="qui-sommes-nous" className="scroll-mt-20 py-[2.625rem] md:py-[3.625rem]">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 md:grid-cols-12 md:gap-14">
        <div className="relative md:col-span-6">
          {evenements.length > 0 ? (
            <CarrouselEvenements evenements={evenements} />
          ) : (
            <Image
              src={PHOTOS.equipe.src}
              alt={PHOTOS.equipe.alt}
              width={PHOTOS.equipe.largeur}
              height={PHOTOS.equipe.hauteur}
              sizes="(min-width: 768px) 50vw, 100vw"
              className="aspect-[4/3] w-full rounded-2xl object-cover"
            />
          )}
        </div>
        <div className="md:col-span-6">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Qui sommes-nous</h2>
          <p className="mt-5 max-w-[60ch] leading-relaxed text-muted-foreground">
            Nous éditons le système de gestion de l’assurance santé collective utilisé par les assureurs, les
            mutuelles et leurs partenaires de soins. Une seule plateforme relie l’entreprise cliente, l’adhérent,
            l’établissement de santé, la pharmacie et l’assureur.
          </p>
          <p className="mt-4 max-w-[60ch] leading-relaxed text-muted-foreground">
            Notre priorité : que chaque prise en charge soit juste, traçable et payée à temps.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
            {REPERES.map(({ icone: Icone, titre, texte }) => (
              <li key={titre}>
                <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icone aria-hidden="true" className="size-5" />
                </span>
                <p className="mt-3 font-display font-semibold">{titre}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{texte}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
