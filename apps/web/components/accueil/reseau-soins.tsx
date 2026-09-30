import { ArrowRight, IdCard, KeyRound, ReceiptText } from 'lucide-react';
import Image from 'next/image';

import { PHOTOS } from './photos';

const PARCOURS = [
  {
    icone: IdCard,
    titre: 'L’adhérent présente sa carte',
    texte: 'Dans un établissement ou une pharmacie du réseau, sa couverture est vérifiée par son numéro de carte.',
  },
  {
    icone: KeyRound,
    titre: 'Chaque acte reçoit un code unique',
    texte: 'Consultation, ordonnance et délivrance sont reliées entre elles : un soin sans chaîne complète n’est pas facturable.',
  },
  {
    icone: ReceiptText,
    titre: 'L’établissement facture l’assureur',
    texte: 'Les prestations validées sont regroupées dans une facture mensuelle, contrôlée puis payée.',
  },
];

/** Réseau de soins : le principe du réseau conventionné (cible du méga menu). */
export function ReseauSoins() {
  return (
    <section id="reseau" className="scroll-mt-20 py-[2.625rem] md:py-[3.625rem]">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 md:grid-cols-12 md:items-center">
        <div className="md:col-span-7">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Le principe du réseau conventionné
          </h2>
          <p className="mt-4 max-w-[60ch] leading-relaxed text-muted-foreground">
            Les établissements de santé et les pharmacies signent une convention avec l’assureur. Leurs tarifs sont
            connus d’avance, et chaque prise en charge suit le même parcours tracé.
          </p>

          <ol className="relative mt-10 space-y-8 before:absolute before:bottom-2 before:left-5 before:top-2 before:w-px before:bg-border">
            {PARCOURS.map(({ icone: Icone, titre, texte }) => (
              <li key={titre} className="relative flex gap-5">
                <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
                  <Icone aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <p className="font-display text-lg font-semibold">{titre}</p>
                  <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{texte}</p>
                </div>
              </li>
            ))}
          </ol>

          <a
            href="#partenaire"
            className="group mt-10 inline-flex items-center gap-2 rounded-md font-medium text-accent-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Rejoindre le réseau
            <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="md:col-span-5">
          <Image
            src={PHOTOS.consultation.src}
            alt={PHOTOS.consultation.alt}
            width={PHOTOS.consultation.largeur}
            height={PHOTOS.consultation.hauteur}
            sizes="(min-width: 768px) 40vw, 100vw"
            className="aspect-[4/5] w-full rounded-2xl object-cover md:aspect-[3/4]"
          />
        </div>
      </div>
    </section>
  );
}
