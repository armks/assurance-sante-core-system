'use client';

import { CheckCircle2, Mail, MapPin, Phone } from 'lucide-react';
import { useEffect, useId, useRef, useState, useTransition } from 'react';

import { envoyerDemande, type ResultatFormulaire } from '@/app/accueil-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { CarteLocalisation } from './carte-localisation';
import { COORDONNEES } from './coordonnees';

type Onglet = 'CONTACT' | 'PARTENAIRE' | 'ADHESION';

const ONGLETS: { id: Onglet; libelle: string; ancre: string }[] = [
  { id: 'CONTACT', libelle: 'Contact', ancre: 'contact' },
  { id: 'PARTENAIRE', libelle: 'Devenir partenaire', ancre: 'partenaire' },
  { id: 'ADHESION', libelle: 'Adhésion', ancre: 'adhesion' },
];

const OBJET_PAR_DEFAUT: Record<Onglet, string> = {
  CONTACT: '',
  PARTENAIRE: 'Candidature au réseau de soins',
  ADHESION: 'Demande d’adhésion',
};

/** Onglet correspondant à l'ancre de l'URL (liens du méga menu). */
function ongletDepuisAncre(): Onglet | null {
  const a = window.location.hash.replace('#', '');
  return ONGLETS.find((o) => o.ancre === a)?.id ?? null;
}

/**
 * Formulaires Contact / Devenir partenaire / Adhésion. `organisation` : slug de
 * la société quand ils sont affichés sur sa page (/{slug}) — la demande lui est
 * alors adressée.
 */
export function Formulaires({ organisation }: { organisation?: string } = {}) {
  const [onglet, setOnglet] = useState<Onglet>('CONTACT');
  const idBase = useId();

  useEffect(() => {
    const synchroniser = () => {
      const o = ongletDepuisAncre();
      if (o) setOnglet(o);
    };
    synchroniser();
    window.addEventListener('hashchange', synchroniser);
    return () => window.removeEventListener('hashchange', synchroniser);
  }, []);

  return (
    <section id="contact" className="scroll-mt-20 bg-muted/40 py-[2.625rem] md:py-[3.625rem]">
      {/* Ancres des liens du méga menu (même section, onglet présélectionné). */}
      <span id="partenaire" className="block scroll-mt-20" aria-hidden="true" />
      <span id="adhesion" className="block scroll-mt-20" aria-hidden="true" />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Parlons de votre projet</h2>
          <p className="mt-4 max-w-[48ch] leading-relaxed text-muted-foreground">
            Une question, une candidature d’établissement ou un projet de couverture pour vos équipes : écrivez-nous,
            nous revenons vers vous rapidement.
          </p>
          <ul className="mt-8 space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <MapPin aria-hidden="true" className="size-4 text-primary" />
              {[COORDONNEES.adresse, COORDONNEES.ville].filter(Boolean).join(', ')}
            </li>
            {COORDONNEES.telephone && (
              <li className="flex items-center gap-3">
                <Phone aria-hidden="true" className="size-4 text-primary" />
                <a href={`tel:${COORDONNEES.telephone.replace(/\s/g, '')}`} className="hover:underline">
                  {COORDONNEES.telephone}
                </a>
              </li>
            )}
            {COORDONNEES.email && (
              <li className="flex items-center gap-3">
                <Mail aria-hidden="true" className="size-4 text-primary" />
                <a href={`mailto:${COORDONNEES.email}`} className="hover:underline">
                  {COORDONNEES.email}
                </a>
              </li>
            )}
          </ul>
        </div>

        <div className="min-w-0 rounded-2xl border bg-card p-5 shadow-[0_24px_48px_-32px_hsl(253_40%_20%/0.35)] sm:p-8 lg:col-span-8">
          <div role="tablist" aria-label="Type de demande" className="flex gap-1 rounded-md bg-muted p-1">
            {ONGLETS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="tab"
                id={`${idBase}-onglet-${o.id}`}
                aria-selected={onglet === o.id}
                aria-controls={`${idBase}-panneau`}
                onClick={() => setOnglet(o.id)}
                className={cn(
                  'min-w-0 flex-1 rounded-md px-2 py-2 text-sm font-medium leading-tight sm:px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  onglet === o.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.libelle}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${idBase}-panneau`} aria-labelledby={`${idBase}-onglet-${onglet}`} className="mt-6">
            {/* `key` : formulaire remonté à chaque onglet (champs et état réinitialisés). */}
            <FormulaireDemande key={onglet} type={onglet} organisation={organisation} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FormulaireDemande({ type, organisation }: { type: Onglet; organisation?: string }) {
  const [pending, start] = useTransition();
  const [resultat, setResultat] = useState<ResultatFormulaire | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  if (resultat?.ok) {
    return (
      <div role="status" className="flex flex-col items-start gap-4 py-8">
        <CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
        <p className="font-display text-xl font-semibold">{resultat.message}</p>
        <Button variant="outline" onClick={() => setResultat(null)}>
          Envoyer une autre demande
        </Button>
      </div>
    );
  }

  const champ = (nom: string) => `${id}-${nom}`;
  const libelleStructure =
    type === 'PARTENAIRE'
      ? 'Nom de l’établissement ou de la pharmacie'
      : type === 'ADHESION'
        ? 'Nom de la société ou de la mutuelle'
        : 'Nom du collectif ou de la société';

  return (
    <form
      ref={form}
      suppressHydrationWarning /* HYDRATATION-IOS : à retirer avant la version définitive */
      noValidate={false}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setResultat(null);
          setResultat(await envoyerDemande(fd));
        });
      }}
      className="grid gap-5 sm:grid-cols-2"
    >
      <input type="hidden" name="type" value={type} />
      {organisation && <input type="hidden" name="organisation" value={organisation} />}

      {/* Pot de miel : invisible et inaccessible aux humains, rempli par les robots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto size-px overflow-hidden">
        <label htmlFor={champ('siteWeb')}>Site web</label>
        <input id={champ('siteWeb')} name="siteWeb" type="text" tabIndex={-1} autoComplete="off" suppressHydrationWarning /* HYDRATATION-IOS */ />
      </div>

      <Bloc id={champ('structure')} libelle={libelleStructure} className="sm:col-span-2">
        <Input id={champ('structure')} name="structure" required minLength={2} maxLength={200} autoComplete="organization" />
      </Bloc>

      {type === 'PARTENAIRE' ? (
        <>
          <Bloc id={champ('categorie')} libelle="Type de structure">
            <select
              id={champ('categorie')}
              suppressHydrationWarning /* HYDRATATION-IOS */
              name="categorie"
              required
              defaultValue=""
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            >
              <option value="" disabled>
                Choisir…
              </option>
              <option value="ETABLISSEMENT">Établissement de santé</option>
              <option value="PHARMACIE">Pharmacie</option>
            </select>
          </Bloc>
          <Bloc id={champ('ville')} libelle="Ville" optionnel>
            <Input id={champ('ville')} name="ville" maxLength={120} autoComplete="address-level2" />
          </Bloc>
          <CarteLocalisation idBase={id} />
        </>
      ) : (
        <Bloc
          id={champ('effectif')}
          libelle="Nombre estimé d’employés ou d’adhérents"
          className="sm:col-span-2"
        >
          <Input id={champ('effectif')} name="effectif" type="number" inputMode="numeric" required min={1} max={1000000} />
        </Bloc>
      )}

      <Bloc id={champ('email')} libelle="E-mail">
        <Input id={champ('email')} name="email" type="email" required maxLength={200} autoComplete="email" />
      </Bloc>
      <Bloc id={champ('telephone')} libelle="Téléphone" aide="Avec l’indicatif, ex. +225 07 00 00 00 00">
        <Input id={champ('telephone')} name="telephone" type="tel" required pattern="\+?[\d\s().\-]{8,20}" autoComplete="tel" />
      </Bloc>
      <Bloc id={champ('objet')} libelle="Objet" className="sm:col-span-2">
        <Input id={champ('objet')} name="objet" required minLength={3} maxLength={150} defaultValue={OBJET_PAR_DEFAUT[type]} />
      </Bloc>
      <Bloc id={champ('message')} libelle="Message" optionnel className="sm:col-span-2">
        <textarea
          id={champ('message')}
          suppressHydrationWarning /* HYDRATATION-IOS */
          name="message"
          rows={4}
          maxLength={3000}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
        />
      </Bloc>

      {resultat && !resultat.ok && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2">
          <p className="font-medium">{resultat.error}</p>
          {resultat.erreurs && (
            <ul className="mt-1 list-disc pl-5">
              {resultat.erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={pending} className="w-full active:scale-[0.98] sm:w-auto">
          {pending ? 'Envoi en cours…' : 'Envoyer'}
        </Button>
      </div>
    </form>
  );
}

function Bloc({
  id,
  libelle,
  aide,
  optionnel,
  className,
  children,
}: {
  id: string;
  libelle: string;
  aide?: string;
  optionnel?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-2', className)}>
      <Label htmlFor={id}>
        {libelle}
        {optionnel && <span className="font-normal text-muted-foreground"> (facultatif)</span>}
      </Label>
      {children}
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}
