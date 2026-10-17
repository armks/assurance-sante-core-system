'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Coins, FileText, HandCoins, Wallet } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import {
  ouvrirContestationActe,
  trancherContestationActe,
} from '@/app/dashboard-assureur/medecin-conseil/contestations/actions';
import {
  Alerte,
  CarteResume,
  ChampZone,
  GrilleCartes,
  FiltresServeur,
  FormulaireModal,
  PaginationServeur,
  StatutBadge,
  type PageServeur,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { BlocAccordeon } from '@/components/dashboard/exploitation-preautorisations-ecran';
import { Input } from '@/components/ui/input';
import { useCategoriesActe } from '@/components/categories-acte';

export interface ActeRevue {
  id: string;
  categorieActe: string;
  libelle: string;
  codeActe: string | null;
  quantite: number;
  montantPrescrit: string | null;
  statut: string;
  datePrescription: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  societe?: string;
  numeroCarte?: string;
  typeVisite?: string | null;
  montantSimuleAssurance?: string | null;
  montantSimulePatient?: string | null;
  contestation: { id: string; statut: string } | null;
}
export interface ContestationActe {
  id: string;
  acteDossierId: string;
  categorieActe: string;
  libelle: string;
  codeActe: string | null;
  montantPrescrit: string | null;
  etablissement: string;
  numeroTraitement: string;
  patient: string;
  motif: string;
  statut: string;
  dateOuverture: string;
  dateLimite: string;
  reponseEtablissement: string | null;
  piecesJustificatives: string[];
  dateCloture: string | null;
  ouvertPar: string | null;
  traitePar: string | null;
  dossierId?: string;
  societe?: string;
  numeroCarte?: string;
  typeVisite?: string | null;
  quantite?: number;
  montantSimuleAssurance?: string | null;
  montantSimulePatient?: string | null;
}

const LIBELLE_CONTESTATION: Record<string, string> = {
  OUVERT: 'Ouverte',
  JUSTIFICATION_RECUE: 'Justification reçue',
  VALIDEE: 'Validée',
  REJETEE: 'Rejetée',
};
const TON_CONTESTATION: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  OUVERT: 'attention',
  JUSTIFICATION_RECUE: 'attention',
  VALIDEE: 'succes',
  REJETEE: 'danger',
};

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const montantFr = (m: string | null) => (m ? `${Number(m).toLocaleString('fr-FR')} F` : '—');

function ContesterActe({ acte, onSucces }: { acte: ActeRevue; onSucces: (m: string) => void }) {
  return (
    <FormulaireModal
      titre="Ouvrir une contestation"
      mode="center"
      description={`${acte.libelle} — ${acte.numeroTraitement} (${acte.patient}), établissement ${acte.etablissement}.`}
      declencheur={<Button size="xs" variant="destructive">Contester</Button>}
      libelleSoumettre="Ouvrir la contestation"
      onSoumettre={async (fd) => ouvrirContestationActe(acte.id, String(fd.get('motif') ?? ''))}
      onSucces={() => onSucces('Contestation ouverte.')}
    >
      <ChampZone
        name="motif"
        label="Motif de la contestation"
        required
        minLength={5}
        maxLength={1000}
        rows={4}
        aide="Tracé dans l'audit — expliquez précisément ce qui est contesté."
      />
    </FormulaireModal>
  );
}

function TrancherContestation({
  contestation,
  onSucces,
}: {
  contestation: ContestationActe;
  onSucces: (m: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        onClick={async () => {
          const r = await trancherContestationActe(contestation.id, 'VALIDEE');
          if (r.ok) onSucces(r.message ?? 'Validée.');
        }}
      >
        Valider
      </Button>
      <Button
        size="xs"
        variant="destructive"
        onClick={async () => {
          const r = await trancherContestationActe(contestation.id, 'REJETEE');
          if (r.ok) onSucces(r.message ?? 'Rejetée.');
        }}
      >
        Rejeter
      </Button>
    </div>
  );
}

/** État de la DERNIÈRE contestation d'un acte — filtre serveur `contestation`. */
const OPTIONS_CONTESTATION = [
  { valeur: 'SANS', libelle: 'Jamais contesté' },
  { valeur: 'EN_COURS', libelle: 'Contestation en cours' },
  { valeur: 'TRAITEE', libelle: 'Contestation tranchée' },
];

const NB = (v: string | null | undefined) => Number(v ?? 0);
const francs = (n: number) => `${n.toLocaleString('fr-FR')} F`;
const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const PAR_PAGE = 10;
const RACINE_DOSSIER = '/dashboard-assureur/medecin-conseil/dossiers';

/** Ligne normalisée (acte à examiner OU contestation) pour le regroupement par dossier. */
interface LigneActe {
  id: string;
  dossierId: string;
  numeroTraitement: string;
  societe: string;
  numeroCarte: string;
  patient: string;
  etablissement: string;
  typeVisite: string;
  date: string;
  libelle: string;
  codeActe: string | null;
  quantite: number | null;
  cout: number;
  assurance: number;
  patientPart: number;
  /** Cellules propres au bloc (statut, motif, réponse…) — alignées sur `entetesExtra`. */
  extra: React.ReactNode[];
  action: React.ReactNode;
}
interface GroupeDossier
  extends Omit<LigneActe, 'id' | 'libelle' | 'codeActe' | 'quantite' | 'extra' | 'action'> {
  lignes: LigneActe[];
}

function grouper(lignes: LigneActe[]): GroupeDossier[] {
  const m = new Map<string, GroupeDossier>();
  for (const l of lignes) {
    let g = m.get(l.dossierId);
    if (!g) {
      g = { ...l, cout: 0, assurance: 0, patientPart: 0, lignes: [] };
      m.set(l.dossierId, g);
    }
    g.cout += l.cout;
    g.assurance += l.assurance;
    g.patientPart += l.patientPart;
    if (l.date > g.date) g.date = l.date;
    g.lignes.push(l);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const typeVisiteFr = (t: string | null | undefined) => t?.replace(/_/g, ' ') ?? '—';

function ligneDepuisActe(a: ActeRevue, extra: React.ReactNode[], action: React.ReactNode): LigneActe {
  return {
    id: a.id,
    dossierId: a.dossierId,
    numeroTraitement: a.numeroTraitement,
    societe: a.societe ?? '—',
    numeroCarte: a.numeroCarte ?? '—',
    patient: a.patient,
    etablissement: a.etablissement,
    typeVisite: typeVisiteFr(a.typeVisite),
    date: a.datePrescription,
    libelle: a.libelle,
    codeActe: a.codeActe,
    quantite: a.quantite,
    cout: NB(a.montantPrescrit),
    assurance: NB(a.montantSimuleAssurance),
    patientPart: NB(a.montantSimulePatient),
    extra,
    action,
  };
}

function ligneDepuisContestation(
  c: ContestationActe,
  date: string,
  extra: React.ReactNode[],
  action: React.ReactNode,
): LigneActe {
  return {
    id: c.id,
    dossierId: c.dossierId ?? c.acteDossierId,
    numeroTraitement: c.numeroTraitement,
    societe: c.societe ?? '—',
    numeroCarte: c.numeroCarte ?? '—',
    patient: c.patient,
    etablissement: c.etablissement,
    typeVisite: typeVisiteFr(c.typeVisite),
    date,
    libelle: c.libelle,
    codeActe: c.codeActe,
    quantite: c.quantite ?? null,
    cout: NB(c.montantPrescrit),
    assurance: NB(c.montantSimuleAssurance),
    patientPart: NB(c.montantSimulePatient),
    extra,
    action,
  };
}

/**
 * Même organisation que les pré-autorisations de l'exploitation : récapitulatif cumulé en tête, UNE ligne par dossier
 * (patient) qui se déplie sur ses actes, bouton « Dossier » vers la fiche complète.
 */
function ListeParDossier({
  lignes,
  libelleActes,
  libelleDate,
  entetesExtra,
  vide,
  avecRecherche = true,
}: {
  lignes: LigneActe[];
  libelleActes: string;
  libelleDate: string;
  entetesExtra: string[];
  vide: string;
  avecRecherche?: boolean;
}) {
  const [q, setQ] = useState('');
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const groupes = useMemo(() => grouper(lignes), [lignes]);
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return groupes;
    return groupes.filter((g) =>
      `${g.numeroTraitement} ${g.societe} ${g.numeroCarte} ${g.patient} ${g.etablissement} ${g.typeVisite} ${g.lignes.map((l) => l.libelle).join(' ')}`
        .toLowerCase()
        .includes(t),
    );
  }, [groupes, q]);

  const nbPages = Math.max(1, Math.ceil(visibles.length / PAR_PAGE));
  const pageCourante = Math.min(page, nbPages - 1);
  const affiches = visibles.slice(pageCourante * PAR_PAGE, (pageCourante + 1) * PAR_PAGE);
  const cumul = visibles.reduce(
    (c, g) => ({
      actes: c.actes + g.lignes.length,
      cout: c.cout + g.cout,
      assurance: c.assurance + g.assurance,
      patient: c.patient + g.patientPart,
    }),
    { actes: 0, cout: 0, assurance: 0, patient: 0 },
  );

  function basculer(id: string) {
    setOuverts((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const lienDossier = (id: string) => (
    <Button asChild size="xs" variant="ghost">
      <Link href={`${RACINE_DOSSIER}/${id}`}>Dossier</Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <GrilleCartes>
        <CarteResume libelle={libelleActes} valeur={cumul.actes} indice={`${visibles.length} dossier(s)`} icon={FileText} />
        <CarteResume libelle="Coût total des actes" valeur={francs(cumul.cout)} icon={Coins} />
        <CarteResume libelle="Part assurance" valeur={francs(cumul.assurance)} icon={HandCoins} />
        <CarteResume libelle="Part à assurer par le patient" valeur={francs(cumul.patient)} icon={Wallet} />
      </GrilleCartes>

      {avecRecherche && (
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Dossier, société, carte, patient, établissement, acte…"
          aria-label="Rechercher dans la liste"
          className="h-9"
        />
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className={`${TH} w-8`} />
              <th className={TH}>N° dossier</th>
              <th className={TH}>Société</th>
              <th className={TH}>N° carte</th>
              <th className={TH}>Patient</th>
              <th className={TH}>Établissement</th>
              <th className={TH}>Consultation</th>
              <th className={`${TH} text-right`}>Coût total</th>
              <th className={`${TH} text-right`}>Assurance</th>
              <th className={TH}>{libelleDate}</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {affiches.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                  {lignes.length === 0 ? vide : 'Aucun résultat pour cette recherche.'}
                </td>
              </tr>
            )}
            {affiches.map((g) => {
              const ouvert = ouverts.has(g.dossierId);
              return (
                <Fragment key={g.dossierId}>
                  <tr
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => basculer(g.dossierId)}
                    aria-expanded={ouvert}
                  >
                    <td className="px-3 py-2">
                      {ouvert ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {g.numeroTraitement}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{g.lignes.length} acte(s)</span>
                    </td>
                    <td className="px-3 py-2">{g.societe}</td>
                    <td className="px-3 py-2 font-mono text-xs">{g.numeroCarte}</td>
                    <td className="px-3 py-2">{g.patient}</td>
                    <td className="px-3 py-2">{g.etablissement}</td>
                    <td className="px-3 py-2">{g.typeVisite}</td>
                    <td className="px-3 py-2 text-right">{francs(g.cout)}</td>
                    <td className="px-3 py-2 text-right">{francs(g.assurance)}</td>
                    <td className="px-3 py-2">{dateFr(g.date)}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {lienDossier(g.dossierId)}
                    </td>
                  </tr>
                  {ouvert && (
                    <tr className="border-t bg-muted/20">
                      <td />
                      <td colSpan={10} className="px-3 py-3">
                        <table className="w-full text-sm">
                          <thead>
                            <tr>
                              <th className={TH}>Acte</th>
                              <th className={TH}>Qté</th>
                              <th className={TH}>Date</th>
                              <th className={`${TH} text-right`}>Coût</th>
                              <th className={`${TH} text-right`}>Part assurance</th>
                              <th className={`${TH} text-right`}>Part patient</th>
                              {entetesExtra.map((e) => (
                                <th key={e} className={TH}>
                                  {e}
                                </th>
                              ))}
                              <th className={TH} />
                            </tr>
                          </thead>
                          <tbody>
                            {g.lignes.map((l) => (
                              <tr key={l.id} className="border-t">
                                <td className="px-3 py-2">
                                  {l.libelle}
                                  {l.codeActe && <span className="ml-2 text-xs text-muted-foreground">{l.codeActe}</span>}
                                </td>
                                <td className="px-3 py-2">{l.quantite ?? '—'}</td>
                                <td className="px-3 py-2">{dateFr(l.date)}</td>
                                <td className="px-3 py-2 text-right">{francs(l.cout)}</td>
                                <td className="px-3 py-2 text-right">{francs(l.assurance)}</td>
                                <td className="px-3 py-2 text-right">{francs(l.patientPart)}</td>
                                {l.extra.map((x, i) => (
                                  <td key={i} className="px-3 py-2">
                                    {x}
                                  </td>
                                ))}
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-end gap-1">
                                    {lienDossier(l.dossierId)}
                                    {l.action}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibles.length > PAR_PAGE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pageCourante + 1} / {nbPages}
          </span>
          <span className="flex gap-1">
            <Button size="xs" variant="outline" disabled={pageCourante === 0} onClick={() => setPage(pageCourante - 1)}>
              Précédent
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={pageCourante >= nbPages - 1}
              onClick={() => setPage(pageCourante + 1)}
            >
              Suivant
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

const badgeContestation = (statut: string) => (
  <StatutBadge statut={statut} map={TON_CONTESTATION} libelles={LIBELLE_CONTESTATION} />
);

export function MedecinConseilActesEcran({
  actes,
  contestations,
}: {
  /** Page d'actes renvoyée par l'API (pagination, recherche et filtres serveur). */
  actes: PageServeur<ActeRevue>;
  contestations: ContestationActe[];
}) {
  const { options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const enCours = contestations.filter((c) => ['OUVERT', 'JUSTIFICATION_RECUE'].includes(c.statut));
  const traitees = contestations.filter((c) => ['VALIDEE', 'REJETEE'].includes(c.statut));

  const lignesActes = actes.items.map((a) =>
    ligneDepuisActe(
      a,
      [a.contestation ? badgeContestation(a.contestation.statut) : '—'],
      !a.contestation ? <ContesterActe acte={a} onSucces={succes} /> : null,
    ),
  );
  const lignesEnCours = enCours.map((c) =>
    ligneDepuisContestation(
      c,
      c.dateOuverture,
      [
        badgeContestation(c.statut),
        dateFr(c.dateLimite),
        c.reponseEtablissement ?? <span className="text-muted-foreground">En attente</span>,
      ],
      <TrancherContestation contestation={c} onSucces={succes} />,
    ),
  );
  const lignesTraitees = traitees.map((c) =>
    ligneDepuisContestation(
      c,
      c.dateCloture ?? c.dateOuverture,
      [badgeContestation(c.statut), c.dateCloture ? dateFr(c.dateCloture) : '—', c.motif],
      null,
    ),
  );

  return (
    <div className="space-y-4">
      {message && <Alerte ton="succes">{message}</Alerte>}

      <BlocAccordeon titre="Actes à examiner" nombre={actes.total} ouvertParDefaut>
        <div className="space-y-4">
          <FiltresServeur
            recherche={{ placeholder: 'Patient, n° de traitement, acte, établissement…' }}
            periode
            libellePeriode="Prescrit"
            selects={[
              { cle: 'contestation', libelle: 'Contestation', options: OPTIONS_CONTESTATION },
              { cle: 'categorie', libelle: 'Catégorie', options: optionsCategories() },
            ]}
          />
          <ListeParDossier
            lignes={lignesActes}
            libelleActes="Actes à examiner"
            libelleDate="Prescrit le"
            entetesExtra={['Contestation']}
            vide="Aucun acte ne correspond à ces critères."
            avecRecherche={false}
          />
          <PaginationServeur page={actes.page} pages={actes.pages} total={actes.total} limite={actes.limite} />
        </div>
      </BlocAccordeon>

      <BlocAccordeon titre="Contestations en cours" nombre={enCours.length} ouvertParDefaut>
        <ListeParDossier
          lignes={lignesEnCours}
          libelleActes="Actes contestés"
          libelleDate="Ouverte le"
          entetesExtra={['Statut', 'Date limite', 'Réponse']}
          vide="Aucune contestation en cours."
        />
      </BlocAccordeon>

      <BlocAccordeon titre="Contestations traitées" nombre={traitees.length}>
        <ListeParDossier
          lignes={lignesTraitees}
          libelleActes="Actes contestés"
          libelleDate="Tranchée le"
          entetesExtra={['Décision', 'Tranchée le', 'Motif']}
          vide="Aucune contestation traitée pour l’instant."
        />
      </BlocAccordeon>
    </div>
  );
}
