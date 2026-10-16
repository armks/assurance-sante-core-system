'use client';

import { CalendarClock, Megaphone, PauseCircle, Radio } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { basculerAnnonce, creerAnnonce, modifierAnnonce, supprimerAnnonce } from '@/app/annonces-actions';
import {
  CarteResume,
  ChampCheckbox,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  ChampZone,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface AnnonceGestion {
  id: string;
  texte: string;
  dureeAffichageSecondes: number;
  dateDebut: string;
  dateFin: string | null;
  actif: boolean;
  organisationId: string | null;
  portee: string;
  enDiffusion: boolean;
  createdAt: string;
}

const CLASSE_CHAMP =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

type EtatAnnonce = 'EN_DIFFUSION' | 'PROGRAMMEE' | 'TERMINEE' | 'INACTIVE';
const LIBELLE_ETAT: Record<EtatAnnonce, string> = {
  EN_DIFFUSION: 'En diffusion',
  PROGRAMMEE: 'Programmée',
  TERMINEE: 'Terminée',
  INACTIVE: 'Désactivée',
};
const TON_ETAT: Record<EtatAnnonce, 'succes' | 'info' | 'neutre' | 'attention'> = {
  EN_DIFFUSION: 'succes',
  PROGRAMMEE: 'info',
  TERMINEE: 'neutre',
  INACTIVE: 'attention',
};

function etat(a: AnnonceGestion, maintenant: number): EtatAnnonce {
  if (!a.actif) return 'INACTIVE';
  if (new Date(a.dateDebut).getTime() > maintenant) return 'PROGRAMMEE';
  if (a.dateFin && new Date(a.dateFin).getTime() <= maintenant) return 'TERMINEE';
  return 'EN_DIFFUSION';
}

const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
/** Valeur d'un champ `datetime-local` (heure locale du navigateur) à partir d'une date ISO. */
const versChampLocal = (d: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  const dec = x.getTimezoneOffset() * 60_000;
  return new Date(x.getTime() - dec).toISOString().slice(0, 16);
};

function ChampsAnnonce({ defaut, superadmin, societes }: { defaut?: AnnonceGestion; superadmin: boolean; societes: { id: string; nom: string }[] }) {
  const [texte, setTexte] = useState(defaut?.texte ?? '');
  return (
    <>
      {superadmin && !defaut && (
        <ChampSelect
          name="portee"
          label="Où diffuser ?"
          required
          placeholder="Choisir…"
          options={[
            { valeur: 'TOUTES', libelle: 'Toutes les pages d’accueil de la plateforme' },
            ...societes.map((s) => ({ valeur: s.id, libelle: `Page d’accueil de ${s.nom}` })),
          ]}
        />
      )}
      <ChampZone
        name="texte"
        label="Message (3 à 300 caractères)"
        required
        minLength={3}
        maxLength={300}
        rows={3}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        aide={`${texte.length} / 300 — un message court défile mieux ; plusieurs annonces actives défilent à la suite.`}
      />
      {texte.trim().length >= 3 && (
        <div className="overflow-hidden rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
          <p className="mb-0.5 text-[11px] font-normal uppercase tracking-wide opacity-80">Aperçu du bandeau</p>
          <p className="truncate">{texte.trim()}</p>
        </div>
      )}
      <ChampNombre
        name="dureeAffichageSecondes"
        label="Durée d’affichage du bandeau (secondes)"
        required
        min={5}
        max={600}
        step={1}
        defaultValue={defaut?.dureeAffichageSecondes ?? 30}
        aide="Le bandeau monte depuis le bas, défile de gauche à droite, puis disparaît après ce délai (5 s à 10 min)."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChampTexte name="dateDebut" label="Début de diffusion" type="datetime-local" defaultValue={versChampLocal(defaut?.dateDebut ?? null)} aide="Vide : tout de suite." />
        <ChampTexte name="dateFin" label="Fin de diffusion" type="datetime-local" defaultValue={versChampLocal(defaut?.dateFin ?? null)} aide="Vide : sans limite." />
      </div>
      <ChampCheckbox name="actif" label="Annonce active" defaultChecked={defaut ? defaut.actif : true} />
    </>
  );
}

/**
 * Gestion du bandeau d'annonces défilant du bas de la page d'accueil : cumul en tête, filtres sur une ligne, tableau, création /
 * modification avec aperçu. L'Assurance Informatique gère les annonces de SA société ; le superadmin gère toutes les annonces et peut
 * diffuser à toutes les pages d'accueil.
 */
export function AnnoncesEcran({
  annonces,
  superadmin = false,
  societes = [],
}: {
  annonces: AnnonceGestion[];
  superadmin?: boolean;
  societes?: { id: string; nom: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [fEtat, setFEtat] = useState('');
  const [fPortee, setFPortee] = useState('');
  const [maintenant] = useState(() => Date.now());

  const lignes = useMemo(
    () => annonces.map((a) => ({ ...a, etat: etat(a, maintenant) })),
    [annonces, maintenant],
  );
  const visibles = lignes.filter((a) => {
    if (q.trim() && !`${a.texte} ${a.portee}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (fEtat && a.etat !== fEtat) return false;
    if (fPortee === 'TOUTES' && a.organisationId) return false;
    if (fPortee && fPortee !== 'TOUTES' && a.organisationId !== fPortee) return false;
    return true;
  });
  const nb = (e: EtatAnnonce) => lignes.filter((a) => a.etat === e).length;
  const filtresActifs = Boolean(q || fEtat || fPortee);

  const colonnes: ColonneTable<(typeof lignes)[number]>[] = [
    {
      cle: 'etat',
      entete: 'État',
      rendu: (a) => <StatutBadge statut={a.etat} ton={TON_ETAT[a.etat]} libelle={LIBELLE_ETAT[a.etat]} />,
    },
    { cle: 'texte', entete: 'Message', rendu: (a) => <span className="line-clamp-2 max-w-[28rem]">{a.texte}</span> },
    ...(superadmin ? [{ cle: 'portee', entete: 'Diffusion', rendu: (a: AnnonceGestion) => a.portee } as ColonneTable<(typeof lignes)[number]>] : []),
    { cle: 'duree', entete: 'Affichage', aligneDroite: true, valeur: (a) => a.dureeAffichageSecondes, rendu: (a) => `${a.dureeAffichageSecondes} s` },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (a) => a.dateDebut,
      rendu: (a) => (
        <span className="text-xs leading-tight">
          du {dateHeureFr(a.dateDebut)}
          <br />
          {a.dateFin ? `au ${dateHeureFr(a.dateFin)}` : 'sans fin'}
        </span>
      ),
    },
  ];

  const lireInput = (fd: FormData) => ({
    texte: String(fd.get('texte') ?? '').trim(),
    dureeAffichageSecondes: Number(fd.get('dureeAffichageSecondes') ?? 30),
    dateDebut: String(fd.get('dateDebut') ?? '') || undefined,
    dateFin: String(fd.get('dateFin') ?? '') || null,
    actif: fd.get('actif') === 'on',
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher dans les messages…"
          aria-label="Rechercher une annonce"
          className="h-9 min-w-0 flex-1"
        />
        <select value={fEtat} onChange={(e) => setFEtat(e.target.value)} aria-label="État" className={`${CLASSE_CHAMP} shrink-0`}>
          <option value="">Tous les états</option>
          {(Object.keys(LIBELLE_ETAT) as EtatAnnonce[]).map((e) => (
            <option key={e} value={e}>
              {LIBELLE_ETAT[e]}
            </option>
          ))}
        </select>
        {superadmin && (
          <select value={fPortee} onChange={(e) => setFPortee(e.target.value)} aria-label="Diffusion" className={`${CLASSE_CHAMP} shrink-0`}>
            <option value="">Toutes les diffusions</option>
            <option value="TOUTES">Toute la plateforme</option>
            {societes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        )}
        {filtresActifs && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              setQ('');
              setFEtat('');
              setFPortee('');
            }}
          >
            Réinitialiser
          </Button>
        )}
        <FormulaireModal
          titre="Nouvelle annonce"
          description="Le message défile de gauche à droite dans un bandeau fixé au bas de la page d’accueil, puis disparaît après la durée choisie."
          declencheurLabel="Nouvelle annonce"
          libelleSoumettre="Publier"
          onSoumettre={async (fd) => creerAnnonce({ ...lireInput(fd), portee: superadmin ? String(fd.get('portee') ?? '') : undefined })}
          onSucces={() => router.refresh()}
        >
          <ChampsAnnonce superadmin={superadmin} societes={societes} />
        </FormulaireModal>
      </div>

      <GrilleCartes>
        <CarteResume libelle="Annonces" valeur={lignes.length} icon={Megaphone} />
        <CarteResume libelle="En diffusion" valeur={nb('EN_DIFFUSION')} icon={Radio} />
        <CarteResume libelle="Programmées" valeur={nb('PROGRAMMEE')} icon={CalendarClock} />
        <CarteResume libelle="Terminées ou désactivées" valeur={nb('TERMINEE') + nb('INACTIVE')} icon={PauseCircle} />
      </GrilleCartes>

      <DataTable
        donnees={visibles}
        cleLigne={(a) => a.id}
        parPage={10}
        colonnes={colonnes}
        actionLigne={(a) => (
          <span className="flex justify-end gap-1">
            <FormulaireModal
              titre="Modifier l’annonce"
              declencheur={
                <Button type="button" size="xs" variant="ghost">
                  Modifier
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) => modifierAnnonce(a.id, lireInput(fd))}
              onSucces={() => router.refresh()}
            >
              <ChampsAnnonce defaut={a} superadmin={superadmin} societes={societes} />
            </FormulaireModal>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={async () => {
                await basculerAnnonce(a.id, !a.actif);
                router.refresh();
              }}
            >
              {a.actif ? 'Désactiver' : 'Activer'}
            </Button>
            <ConfirmationAction
              action="supprimer"
              element={`l’annonce « ${a.texte.slice(0, 40)}${a.texte.length > 40 ? '…' : ''} »`}
              onConfirmer={() => supprimerAnnonce(a.id)}
              onSucces={() => router.refresh()}
            />
          </span>
        )}
        vide={annonces.length === 0 ? 'Aucune annonce. Cliquez sur « Nouvelle annonce » pour diffuser un message.' : 'Aucune annonce ne correspond à ces critères.'}
      />
    </div>
  );
}
