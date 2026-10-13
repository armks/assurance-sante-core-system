'use client';

import { useCallback, useRef, useState } from 'react';

import {
  Champ,
  ChampNombre,
  ChampSelect,
  ChampTexte,
} from '@/components/dashboard/patterns';
import { Input } from '@/components/ui/input';
import { useEchapFermeTableau } from './popup-recherche';
import {
  rechercherActesCatalogue,
  tarifReferenceActe,
  type ActeCatalogue,
  type SituationActe,
} from '@/app/dashboard-centre-medical/medecin/actions';

export interface MedecinCentre {
  id: string;
  libelle: string;
}

/** Heure locale du poste au format `datetime-local` (AAAA-MM-JJTHH:MM). */
function maintenantLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Initialisé au montage — le formulaire est remonté à chaque ouverture, la valeur proposée est donc toujours « maintenant ».
 */
export function ChampDateRealisation() {
  const [valeur] = useState(maintenantLocal);
  return (
    <ChampTexte
      name="dateRealisation"
      label="Date et heure de réalisation"
      type="datetime-local"
      required
      defaultValue={valeur}
      max={valeur}
      aide="Maintenant par défaut — modifiez-la si l’acte a été effectué à un autre moment que sa saisie."
    />
  );
}

/** Médecin qui a effectué l'acte — obligatoire quand c'est l'accueil qui le déclare (« sur information du médecin »). */
export function ChampMedecinRealisateur({ medecins }: { medecins: MedecinCentre[] }) {
  return (
    <ChampSelect
      name="medecinId"
      label="Médecin ayant effectué l’acte"
      required
      placeholder={medecins.length > 0 ? 'Choisir le médecin…' : 'Aucun médecin dans cet établissement'}
      options={medecins.map((m) => ({ valeur: m.id, libelle: m.libelle }))}
      aide="Le médecin vous a informé de l’acte : son nom et votre déclaration sont tracés dans l’audit."
    />
  );
}

/** Lit le médecin et la date de réalisation d'un formulaire (date ISO avec fuseau, depuis l'heure locale du poste). */
export function lireRealisation(fd: FormData): { medecinId?: string; dateRealisation?: string } {
  const v = String(fd.get('dateRealisation') ?? '');
  return {
    medecinId: String(fd.get('medecinId') ?? '') || undefined,
    dateRealisation: v ? new Date(v).toISOString() : undefined,
  };
}

const LIBELLE_SITUATION: Record<SituationActe, string> = {
  A_EFFECTUER: 'À effectuer (prescrit)',
  PROPOSE: 'Proposé à l’assurance — validation avant exécution',
  EFFECTUE: 'Déjà effectué',
};

const montantFr = (n: number) => `${n.toLocaleString('fr-FR')} F`;

/**
 * Champs d'ajout d'un acte de soins, selon sa situation :
 *  - à effectuer ; - proposé à l'assurance pour validation AVANT exécution ; - déjà effectué (médecin à désigner si c'est l'accueil).
 *
 * Ordre de saisie : 1) la CATÉGORIE, 2) le libellé — dès les premières lettres, les actes correspondants du référentiel du système
 * s'affichent dans un TABLEAU POPUP (acte, code, montant unitaire) limité à cette catégorie ; en choisir un (souris ou clavier) renseigne le
 * libellé ET le montant unitaire de la convention de l'établissement s'il existe en base — sinon le montant reste à saisir. Sans
 * correspondance, le libellé tapé est conservé (acte hors référentiel).
 */
export function ChampsNouvelActe({
  dossierId,
  categories,
  estAccueil,
  medecins,
  typeVisite,
}: {
  dossierId: string;
  categories: { valeur: string; libelle: string }[];
  estAccueil: boolean;
  medecins: MedecinCentre[];
  /** Type de visite du dossier : il fixe le CONTEXTE du tarif de la convention (valeur de lettre-clé hospitalisation ou ambulatoire). */
  typeVisite: string | null;
}) {
  const contexteTarif = typeVisite === 'HOSPITALISATION_MEDICALE' ? 'hospitalisation' : 'ambulatoire';
  const [situation, setSituation] = useState<SituationActe>('EFFECTUE');
  const [categorie, setCategorie] = useState('');
  const [libelle, setLibelle] = useState('');
  const [code, setCode] = useState('');
  const [montant, setMontant] = useState('');
  /** Montant repris de la convention et non modifié : l'API le résout elle-même à l'ajout (origine tracée). */
  const [montantAuto, setMontantAuto] = useState(false);
  const [tarifAbsent, setTarifAbsent] = useState(false);
  const [chargementTarif, setChargementTarif] = useState(false);
  const [resultats, setResultats] = useState<ActeCatalogue[]>([]);
  const [recherche, setRecherche] = useState<'repos' | 'en-cours' | 'vide'>('repos');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const champLibelle = useRef<HTMLInputElement>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Numéro de la dernière recherche : une réponse tardive d'une frappe précédente est ignorée. */
  const sequence = useRef(0);

  function reinitialiserMontant() {
    setMontant('');
    setMontantAuto(false);
    setTarifAbsent(false);
    setChargementTarif(false);
  }

  async function chercher(terme: string, cat: string, immediat: boolean) {
    clearTimeout(minuteur.current);
    const numero = ++sequence.current;
    setRecherche('en-cours');
    const lancer = async () => {
      const trouves = await rechercherActesCatalogue(terme, cat, dossierId);
      if (numero !== sequence.current) return;
      setResultats(trouves);
      setActif(trouves.length > 0 ? 0 : -1);
      setRecherche(trouves.length > 0 ? 'repos' : 'vide');
    };
    if (immediat) await lancer();
    else minuteur.current = setTimeout(lancer, 250);
  }

  function choisirCategorie(cat: string) {
    setCategorie(cat);
    // les actes proposés dépendent de la catégorie : tout ce qui avait été choisi pour l'ancienne est abandonné
    setLibelle('');
    setCode('');
    reinitialiserMontant();
    setResultats([]);
    setActif(-1);
    if (cat) {
      setOuvert(true);
      void chercher('', cat, true);
      // le champ libellé vient d'être activé : le curseur s'y place pour taper tout de suite
      setTimeout(() => champLibelle.current?.focus(), 0);
    } else {
      setOuvert(false);
      sequence.current++;
      setRecherche('repos');
    }
  }

  function saisirLibelle(valeur: string) {
    setLibelle(valeur);
    setOuvert(true);
    if (code) {
      // le libellé a été modifié à la main : ce n'est plus l'acte du référentiel choisi
      setCode('');
      reinitialiserMontant();
    }
    void chercher(valeur, categorie, false);
  }

  async function choisir(a: ActeCatalogue) {
    sequence.current++;
    clearTimeout(minuteur.current);
    setLibelle(a.libelle);
    setCode(a.code);
    setResultats([]);
    setActif(-1);
    setOuvert(false);
    setRecherche('repos');
    reinitialiserMontant();
    if (a.tarifUnitaire !== undefined) {
      // tarif déjà joint à la ligne du tableau
      if (a.tarifUnitaire !== null) {
        setMontant(String(a.tarifUnitaire));
        setMontantAuto(true);
      } else {
        setTarifAbsent(true);
      }
      return;
    }
    setChargementTarif(true);
    const tarif = await tarifReferenceActe(dossierId, a.code, categorie);
    setChargementTarif(false);
    if (tarif !== null) {
      setMontant(String(tarif));
      setMontantAuto(true);
    } else {
      setTarifAbsent(true);
    }
  }

  function toucheLibelle(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!ouvert) {
      if (e.key === 'ArrowDown' && categorie) setOuvert(true);
      return;
    }
    if (e.key === 'ArrowDown' && resultats.length > 0) {
      e.preventDefault();
      setActif((i) => (i + 1) % resultats.length);
    } else if (e.key === 'ArrowUp' && resultats.length > 0) {
      e.preventDefault();
      setActif((i) => (i <= 0 ? resultats.length - 1 : i - 1));
    } else if (e.key === 'Enter' && actif >= 0 && resultats[actif]) {
      e.preventDefault(); // ne soumet pas le formulaire : choisit l'acte surligné
      void choisir(resultats[actif]);
    }
  }

  const tableauVisible = ouvert && !!categorie && (recherche !== 'repos' || resultats.length > 0);

  const fermerTableau = useCallback(() => setOuvert(false), []);
  useEchapFermeTableau(tableauVisible, fermerTableau);

  return (
    <>
      <ChampSelect
        name="situation"
        label="Situation de l’acte"
        required
        value={situation}
        onChange={(e) => setSituation(e.target.value as SituationActe)}
        options={(Object.keys(LIBELLE_SITUATION) as SituationActe[]).map((s) => ({ valeur: s, libelle: LIBELLE_SITUATION[s] }))}
        aide={
          situation === 'PROPOSE'
            ? 'L’assurance valide (ou refuse) AVANT que l’acte soit effectué ; il n’est pas facturable tant qu’elle n’a pas approuvé.'
            : situation === 'EFFECTUE'
              ? estAccueil
                ? 'Le médecin vous a informé de l’acte : indiquez son nom, l’acte devient facturable.'
                : 'Vous attestez que l’acte a été effectué : il devient facturable.'
              : 'L’acte reste à effectuer ; il sera à déclarer réalisé pour être facturé.'
        }
      />

      <ChampSelect
        name="categorieActe"
        label="Catégorie"
        required
        placeholder="Choisir la catégorie…"
        value={categorie}
        onChange={(e) => choisirCategorie(e.target.value)}
        options={categories}
        aide="À choisir en premier : la recherche de l’acte se limite à cette catégorie."
      />

      <Champ
        label="Libellé de l’acte"
        htmlFor="champ-libelle"
        requis
        aide={
          !categorie
            ? 'Choisissez d’abord la catégorie.'
            : code
              ? `Acte du référentiel : ${code}.`
              : 'Tapez les premières lettres : les actes correspondants s’affichent dans le tableau. Sans correspondance, le libellé saisi est conservé (acte hors référentiel).'
        }
      >
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOuvert(false);
          }}
        >
          <Input
            id="champ-libelle"
            ref={champLibelle}
            name="libelle"
            required
            maxLength={300}
            autoComplete="off"
            role="combobox"
            aria-expanded={tableauVisible}
            aria-controls="tableau-actes"
            aria-autocomplete="list"
            disabled={!categorie}
            placeholder={categorie ? 'Tapez pour rechercher un acte…' : 'Choisissez d’abord la catégorie'}
            value={libelle}
            onChange={(e) => saisirLibelle(e.target.value)}
            onFocus={() => categorie && setOuvert(true)}
            onKeyDown={toucheLibelle}
          />
          {tableauVisible && (
            <div
              id="tableau-actes"
              role="listbox"
              aria-label="Actes du référentiel"
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-sm text-popover-foreground shadow-md"
            >
              <div aria-hidden="true" className="sticky top-0 grid grid-cols-[1fr_auto_auto] gap-3 border-b bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Acte</span>
                <span>Code</span>
                <span className="w-28 text-right">{typeVisite ? `Montant (${contexteTarif})` : 'Montant unitaire'}</span>
              </div>
              {recherche === 'en-cours' && <p className="px-3 py-2 text-xs text-muted-foreground">Recherche dans le référentiel…</p>}
              {recherche === 'vide' && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Aucun acte du référentiel ne correspond dans cette catégorie : le libellé saisi sera utilisé tel quel, avec un montant à saisir.
                </p>
              )}
              {resultats.map((a, i) => (
                <div
                  key={a.id}
                  role="option"
                  aria-selected={i === actif}
                  className={`grid cursor-pointer grid-cols-[1fr_auto_auto] items-baseline gap-3 px-3 py-1.5 ${i === actif ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActif(i)}
                  onClick={() => void choisir(a)}
                >
                  <span>{a.libelle}</span>
                  <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                  <span className="w-28 text-right tabular-nums" title={a.tarifUnitaire == null ? 'Pas de tarif en base pour cet acte' : `Tarif de la convention (${contexteTarif})`}>
                    {a.tarifUnitaire == null ? '—' : montantFr(a.tarifUnitaire)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Champ>
      <input type="hidden" name="codeActe" value={code} />
      <input type="hidden" name="montantAuto" value={montantAuto ? '1' : ''} />

      <ChampNombre name="quantite" label="Quantité" min={1} defaultValue={1} />
      <ChampNombre
        name="montantPrescrit"
        label="Montant unitaire (F)"
        min={0}
        step="0.01"
        value={montant}
        onChange={(e) => {
          setMontant(e.target.value);
          setMontantAuto(false);
        }}
        aide={
          chargementTarif
            ? 'Recherche du tarif de la convention…'
            : montantAuto
              ? `Tarif de la convention de l’établissement — contexte ${contexteTarif} (modifiable).`
              : !typeVisite
                ? 'Le tarif de la convention dépend du type de visite (ambulatoire ou hospitalisation) : définissez-le d’abord dans le dossier pour le voir apparaître. Sinon, saisissez le montant.'
                : code && tarifAbsent
                  ? 'Aucun tarif en base pour cet acte : saisissez le montant.'
                  : 'Choisissez un acte pour afficher son tarif, ou saisissez le montant.'
        }
      />
      {situation === 'EFFECTUE' && (
        <>
          {estAccueil && <ChampMedecinRealisateur medecins={medecins} />}
          <ChampDateRealisation />
        </>
      )}
    </>
  );
}
