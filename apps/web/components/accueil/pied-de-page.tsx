'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';

import { inscrireNewsletter, type ResultatFormulaire } from '@/app/accueil-actions';

import { COORDONNEES, REFERENCES } from './coordonnees';
import { ancrer, type MarqueVitrine } from './marque';

const LIENS = [
  { libelle: 'Réseau de soins', href: '/reseau-de-soins' },
  { libelle: 'Devenir partenaire', href: '/#partenaire' },
  { libelle: 'Adhésion', href: '/#adhesion' },
  { libelle: 'Qui sommes-nous', href: '/#qui-sommes-nous' },
  { libelle: 'Contact', href: '/#contact' },
];

/**
 * Pied de page (bande nuit, même teinte que la bannière) + newsletter. Sur la
 * page d'une société (/{slug}) : son nom, liens de section restant sur sa page,
 * et ses coordonnées de contact (e-mail — celui qui reçoit ses formulaires — et
 * téléphone) si elle en a ; sinon les coordonnées de la plateforme.
 */
export function PiedDePage({
  marque,
  racine = '/',
  contact,
}: {
  marque?: MarqueVitrine;
  racine?: string;
  contact?: { email: string | null; telephone: string | null };
} = {}) {
  const nom = marque?.nom ?? 'Assurance Santé';
  const contactSociete = contact && (contact.email || contact.telephone) ? contact : null;
  return (
    <footer className="bg-nuit text-white/80">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-8 sm:px-6 md:grid-cols-2 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="font-display text-lg font-semibold text-white">{nom}</p>
          <p className="mt-3 max-w-[40ch] text-sm leading-relaxed">
            Le système de gestion de l’assurance santé collective, du devis au remboursement.
          </p>
          {contactSociete ? (
            <address className="mt-5 space-y-1 text-sm not-italic">
              {contactSociete.telephone && (
                <p>
                  <a href={`tel:${contactSociete.telephone.replace(/\s/g, '')}`} className="hover:text-white hover:underline">
                    {contactSociete.telephone}
                  </a>
                </p>
              )}
              {contactSociete.email && (
                <p>
                  <a href={`mailto:${contactSociete.email}`} className="hover:text-white hover:underline">
                    {contactSociete.email}
                  </a>
                </p>
              )}
            </address>
          ) : (
            <address className="mt-5 space-y-1 text-sm not-italic">
              {COORDONNEES.adresse && <p>{COORDONNEES.adresse}</p>}
              <p>{COORDONNEES.ville}</p>
              {COORDONNEES.telephone && <p>{COORDONNEES.telephone}</p>}
              {COORDONNEES.email && <p>{COORDONNEES.email}</p>}
            </address>
          )}
        </div>

        <nav aria-label="Liens utiles" className="lg:col-span-2">
          <p className="text-sm font-semibold text-white">Liens utiles</p>
          <ul className="mt-4 space-y-2 text-sm">
            {LIENS.map((l) => (
              <li key={l.href}>
                <a href={ancrer(l.href, racine)} className="hover:text-white hover:underline">
                  {l.libelle}
                </a>
              </li>
            ))}
            <li>
              <Link href="/login" className="hover:text-white hover:underline">
                Connexion
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Références" className="lg:col-span-3">
          <p className="text-sm font-semibold text-white">Références</p>
          <ul className="mt-4 space-y-2 text-sm">
            {REFERENCES.map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">
                  {r.libelle}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="md:col-span-2 lg:col-span-3">
          <Newsletter />
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs text-white/60 sm:px-6">
          © {new Date().getFullYear()}{` ${nom}. Tous droits réservés.`}
        </p>
      </div>
    </footer>
  );
}

function Newsletter() {
  const [pending, start] = useTransition();
  const [resultat, setResultat] = useState<ResultatFormulaire | null>(null);
  const id = useId();

  return (
    <div>
      <p className="text-sm font-semibold text-white">Newsletter</p>
      <p className="mt-2 text-sm leading-relaxed">Les nouveautés de la plateforme, quelques fois par an.</p>
      {resultat?.ok ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-white">
          <CheckCircle2 aria-hidden="true" className="size-4 text-[#c9b8ff]" />
          {resultat.message}
        </p>
      ) : (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => setResultat(await inscrireNewsletter(fd)));
          }}
        >
          {/* Pot de miel : invisible et inaccessible aux humains. */}
          <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
            <label htmlFor={`${id}-site`}>Site web</label>
            <input id={`${id}-site`} name="siteWeb" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <label htmlFor={`${id}-email`} className="text-sm text-white">
            Votre e-mail
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id={`${id}-email`}
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              className="h-10 min-w-0 flex-1 rounded-md border border-white/25 bg-white/10 px-3 text-sm text-white placeholder:text-white/50 outline-none focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
            />
            <button
              type="submit"
              disabled={pending}
              className="h-10 shrink-0 rounded-md bg-white px-4 text-sm font-medium text-nuit transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? 'Envoi…' : 'S’inscrire'}
            </button>
          </div>
          {resultat && !resultat.ok && (
            <p role="alert" className="mt-2 text-sm text-[#ffb4b4]">
              {resultat.erreurs?.join(' ') ?? resultat.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
