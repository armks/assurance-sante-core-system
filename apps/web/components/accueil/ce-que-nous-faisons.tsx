import { FileCheck2, IdCard, Receipt, Stethoscope } from 'lucide-react';
import Image from 'next/image';

import { FriseAntiFraude } from './frise-anti-fraude';
import { PHOTOS } from './photos';

/**
 * « Ce que nous faisons » : grille asymétrique, une tuile par capacité RÉELLE
 * du système (pas de généralités). 6 colonnes au-delà de md :
 *   ligne 1   : anti-fraude (4 col, fond nuit) | cotisations (2 col, teintée)
 *   ligne 2   : frise des quatre codes (6 col, animée)
 *   ligne 3-4 : réseau (2 col, photo, 2 lignes) | cartes de membre (4 col)
 *                                              | médecin et pharmacien conseil (4 col)
 * Une seule colonne sous md, dans cet ordre.
 */
export function CeQueNousFaisons() {
  return (
    <section id="services" className="scroll-mt-20 bg-muted/40 py-[2.625rem] md:py-[3.625rem]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Ce que nous faisons
        </h2>
        <p className="mt-4 max-w-[62ch] leading-relaxed text-muted-foreground">
          Les fonctions qui font tourner une assurance santé collective, de la carte de l’adhérent au paiement de
          l’établissement.
        </p>

        <div className="mt-12 grid gap-4 md:grid-cols-6">
          {/* Anti-fraude : tuile principale, fond nuit. Le détail des quatre codes
              est dans la frise juste en dessous. */}
          <article className="rounded-2xl bg-[#17152b] p-7 text-white md:col-span-4 md:p-10">
            <h3 className="font-display text-2xl font-semibold md:text-3xl">Un parcours anti-fraude en quatre codes</h3>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-white/75">
              Chaque étape du parcours de soins reçoit son propre code à usage unique. Une prestation ne peut être
              facturée que si toute la chaîne est complète et cohérente.
            </p>
          </article>

          {/* Cotisations : tuile teintée. */}
          <article className="rounded-2xl bg-accent p-6 text-accent-foreground md:col-span-2 md:p-8">
            <Receipt aria-hidden="true" className="size-6" />
            <h3 className="mt-4 font-display text-xl font-semibold">Cotisations et facturation</h3>
            <p className="mt-2 text-sm leading-relaxed">
              Appels de cotisation, factures mensuelles des établissements et remboursements calculés au franc près.
            </p>
          </article>

          {/* Frise dynamique des quatre codes, pleine largeur. */}
          <div className="md:col-span-6">
            <FriseAntiFraude />
          </div>

          {/* Réseau : tuile photo. */}
          <article className="relative isolate flex min-h-[260px] flex-col justify-end overflow-hidden rounded-2xl p-6 text-white md:col-span-2 md:row-span-2">
            <Image
              src={PHOTOS.heroPharmacie.src}
              alt=""
              fill
              sizes="(min-width: 768px) 33vw, 100vw"
              className="-z-10 object-cover"
            />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-[#17152b]/95 via-[#17152b]/55 to-transparent" />
            <h3 className="font-display text-xl font-semibold">Réseau de soins conventionné</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/85">
              Établissements de santé et pharmacies partenaires, avec leurs tarifs négociés.
            </p>
          </article>

          <article className="flex gap-5 rounded-2xl border bg-card p-6 md:col-span-4">
            <IdCard aria-hidden="true" className="size-6 shrink-0 text-primary" />
            <div>
              <h3 className="font-display text-xl font-semibold">Cartes de membre</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Carte au format bancaire avec photo et QR code, pour l’adhérent et chacun de ses bénéficiaires.
              </p>
            </div>
          </article>

          <article className="flex gap-5 rounded-2xl border bg-card p-6 md:col-span-4">
            <span className="flex shrink-0 gap-1 text-primary">
              <Stethoscope aria-hidden="true" className="size-6" />
              <FileCheck2 aria-hidden="true" className="size-6" />
            </span>
            <div>
              <h3 className="font-display text-xl font-semibold">Médecin et pharmacien conseil</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Les actes et les ordonnances sensibles passent par la validation d’un professionnel de santé de
                l’assureur.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
