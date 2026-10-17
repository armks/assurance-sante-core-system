'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Gavel, PackageCheck, PackageX, Pill } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import {
  ouvrirContestation,
  trancherContestation,
} from '@/app/dashboard-assureur/pharmacien-conseil/prescriptions/actions';
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

export interface LignePrescription {
  id: string;
  denominationMedicament: string;
  posologie: string;
  quantitePrescrite: number;
  statut: string;
  pharmacieServante: string | null;
  contestation: { id: string; statut: string } | null;
}
export interface OrdonnanceRevue {
  id: string;
  statut: string;
  datePrescription: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  societe?: string;
  numeroCarte?: string;
  typeVisite?: string | null;
  lignes: LignePrescription[];
}
export interface Contestation {
  id: string;
  ligneOrdonnanceId: string;
  denominationMedicament: string;
  posologie: string;
  quantitePrescrite: number;
  pharmacie: { id: string; nom: string } | null;
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
  etablissement?: string;
  societe?: string;
  numeroCarte?: string;
  typeVisite?: string | null;
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

interface LigneAplatie extends LignePrescription {
  ordonnanceId: string;
  dossierId: string;
  numeroTraitement: string;
  etablissement: string;
  patient: string;
  datePrescription: string;
}

function ContesterLigne({ ligne, onSucces }: { ligne: LigneAplatie; onSucces: (m: string) => void }) {
  return (
    <FormulaireModal
      titre="Ouvrir une contestation"
      mode="center"
      description={`${ligne.denominationMedicament} — ${ligne.numeroTraitement} (${ligne.patient}), délivrée par ${ligne.pharmacieServante ?? '—'}.`}
      declencheur={<Button size="xs" variant="destructive">Contester</Button>}
      libelleSoumettre="Ouvrir la contestation"
      onSoumettre={async (fd) => ouvrirContestation(ligne.id, String(fd.get('motif') ?? ''))}
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
  contestation: Contestation;
  onSucces: (m: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="xs"
        variant="outline"
        onClick={async () => {
          const r = await trancherContestation(contestation.id, 'VALIDEE');
          if (r.ok) onSucces(r.message ?? 'Validée.');
        }}
      >
        Valider
      </Button>
      <Button
        size="xs"
        variant="destructive"
        onClick={async () => {
          const r = await trancherContestation(contestation.id, 'REJETEE');
          if (r.ok) onSucces(r.message ?? 'Rejetée.');
        }}
      >
        Rejeter
      </Button>
    </div>
  );
}

/** Ordonnance retenue si AU MOINS UNE ligne est dans cet état (filtre serveur). */
const OPTIONS_CONTESTATION = [
  { valeur: 'SANS', libelle: 'Une ligne jamais contestée' },
  { valeur: 'EN_COURS', libelle: 'Contestation en cours' },
  { valeur: 'TRAITEE', libelle: 'Contestation tranchée' },
];

const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const PAR_PAGE = 10;
const RACINE_DOSSIER = '/dashboard-assureur/pharmacien-conseil/dossiers';
const typeVisiteFr = (t: string | null | undefined) => t?.replace(/_/g, ' ') ?? '—';

/** Ligne normalisée (prescription OU contestation) pour le regroupement par dossier. */
interface LigneMedicament {
  id: string;
  dossierId: string;
  numeroTraitement: string;
  societe: string;
  numeroCarte: string;
  patient: string;
  etablissement: string;
  typeVisite: string;
  date: string;
  medicament: string;
  posologie: string;
  quantite: number;
  servie: boolean | null;
  contestee: boolean;
  /** Cellules propres au bloc, alignées sur `entetesExtra`. */
  extra: React.ReactNode[];
  action: React.ReactNode;
}
interface GroupeDossier {
  dossierId: string;
  numeroTraitement: string;
  societe: string;
  numeroCarte: string;
  patient: string;
  etablissement: string;
  typeVisite: string;
  date: string;
  lignes: LigneMedicament[];
}

function grouper(lignes: LigneMedicament[]): GroupeDossier[] {
  const m = new Map<string, GroupeDossier>();
  for (const l of lignes) {
    let g = m.get(l.dossierId);
    if (!g) {
      g = {
        dossierId: l.dossierId,
        numeroTraitement: l.numeroTraitement,
        societe: l.societe,
        numeroCarte: l.numeroCarte,
        patient: l.patient,
        etablissement: l.etablissement,
        typeVisite: l.typeVisite,
        date: l.date,
        lignes: [],
      };
      m.set(l.dossierId, g);
    }
    if (l.date > g.date) g.date = l.date;
    g.lignes.push(l);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Même organisation que les contestations du médecin conseil : récapitulatif cumulé en tête, UNE ligne par dossier
 * (patient) qui se déplie sur ses médicaments prescrits, bouton « Dossier » vers la fiche complète.
 */
function ListeParDossier({
  lignes,
  libelleLignes,
  libelleDate,
  entetesExtra,
  vide,
  avecRecherche = true,
}: {
  lignes: LigneMedicament[];
  libelleLignes: string;
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
      `${g.numeroTraitement} ${g.societe} ${g.numeroCarte} ${g.patient} ${g.etablissement} ${g.typeVisite} ${g.lignes.map((l) => l.medicament).join(' ')}`
        .toLowerCase()
        .includes(t),
    );
  }, [groupes, q]);

  const nbPages = Math.max(1, Math.ceil(visibles.length / PAR_PAGE));
  const pageCourante = Math.min(page, nbPages - 1);
  const affiches = visibles.slice(pageCourante * PAR_PAGE, (pageCourante + 1) * PAR_PAGE);
  const toutes = visibles.flatMap((g) => g.lignes);
  const cumul = {
    lignes: toutes.length,
    servies: toutes.filter((l) => l.servie === true).length,
    nonDelivrees: toutes.filter((l) => l.servie === false).length,
    contestees: toutes.filter((l) => l.contestee).length,
  };

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
        <CarteResume libelle={libelleLignes} valeur={cumul.lignes} indice={`${visibles.length} dossier(s)`} icon={Pill} />
        <CarteResume libelle="Servies" valeur={cumul.servies} icon={PackageCheck} />
        <CarteResume libelle="Non délivrées" valeur={cumul.nonDelivrees} icon={PackageX} />
        <CarteResume libelle="Contestées" valeur={cumul.contestees} icon={Gavel} />
      </GrilleCartes>

      {avecRecherche && (
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Dossier, société, carte, patient, établissement, médicament…"
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
              <th className={`${TH} text-right`}>Lignes</th>
              <th className={`${TH} text-right`}>Servies</th>
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
              const servies = g.lignes.filter((l) => l.servie === true).length;
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
                    <td className="px-3 py-2 font-medium">{g.numeroTraitement}</td>
                    <td className="px-3 py-2">{g.societe}</td>
                    <td className="px-3 py-2 font-mono text-xs">{g.numeroCarte}</td>
                    <td className="px-3 py-2">{g.patient}</td>
                    <td className="px-3 py-2">{g.etablissement}</td>
                    <td className="px-3 py-2">{g.typeVisite}</td>
                    <td className="px-3 py-2 text-right">{g.lignes.length}</td>
                    <td className="px-3 py-2 text-right">{servies}</td>
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
                              <th className={TH}>Médicament</th>
                              <th className={TH}>Posologie</th>
                              <th className={TH}>Qté</th>
                              <th className={TH}>Date</th>
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
                                <td className="px-3 py-2">{l.medicament}</td>
                                <td className="px-3 py-2">{l.posologie}</td>
                                <td className="px-3 py-2">{l.quantite}</td>
                                <td className="px-3 py-2">{dateFr(l.date)}</td>
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

function ligneDepuisContestation(
  c: Contestation,
  date: string,
  extra: React.ReactNode[],
  action: React.ReactNode,
): LigneMedicament {
  return {
    id: c.id,
    dossierId: c.dossierId ?? c.ligneOrdonnanceId,
    numeroTraitement: c.numeroTraitement,
    societe: c.societe ?? '—',
    numeroCarte: c.numeroCarte ?? '—',
    patient: c.patient,
    etablissement: c.etablissement ?? '—',
    typeVisite: typeVisiteFr(c.typeVisite),
    date,
    medicament: c.denominationMedicament,
    posologie: c.posologie,
    quantite: c.quantitePrescrite,
    servie: null,
    contestee: true,
    extra,
    action,
  };
}

export function PharmacienConseilPrescriptionsEcran({
  ordonnances,
  contestations,
}: {
  /** Page d'ordonnances renvoyée par l'API (pagination, recherche et filtres serveur). */
  ordonnances: PageServeur<OrdonnanceRevue>;
  contestations: Contestation[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  function succes(msg: string) {
    setMessage(msg);
    router.refresh();
  }

  const lignesPrescrites: LigneMedicament[] = ordonnances.items.flatMap((o) =>
    o.lignes.map((l) => {
      const ligne: LigneAplatie = {
        ...l,
        ordonnanceId: o.id,
        dossierId: o.dossierId,
        numeroTraitement: o.numeroTraitement,
        etablissement: o.etablissement,
        patient: o.patient,
        datePrescription: o.datePrescription,
      };
      return {
        id: l.id,
        dossierId: o.dossierId,
        numeroTraitement: o.numeroTraitement,
        societe: o.societe ?? '—',
        numeroCarte: o.numeroCarte ?? '—',
        patient: o.patient,
        etablissement: o.etablissement,
        typeVisite: typeVisiteFr(o.typeVisite),
        date: o.datePrescription,
        medicament: l.denominationMedicament,
        posologie: l.posologie,
        quantite: l.quantitePrescrite,
        servie: l.statut === 'SERVIE',
        contestee: l.contestation !== null,
        extra: [
          l.statut === 'SERVIE' ? (
            <span className="text-xs">Servie — {l.pharmacieServante}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Non délivrée</span>
          ),
          l.contestation ? badgeContestation(l.contestation.statut) : '—',
        ],
        action: l.statut === 'SERVIE' && !l.contestation ? <ContesterLigne ligne={ligne} onSucces={succes} /> : null,
      };
    }),
  );

  const enCours = contestations.filter((c) => ['OUVERT', 'JUSTIFICATION_RECUE'].includes(c.statut));
  const traitees = contestations.filter((c) => ['VALIDEE', 'REJETEE'].includes(c.statut));

  const lignesEnCours = enCours.map((c) =>
    ligneDepuisContestation(
      c,
      c.dateOuverture,
      [
        c.pharmacie?.nom ?? '—',
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
      [c.pharmacie?.nom ?? '—', badgeContestation(c.statut), c.dateCloture ? dateFr(c.dateCloture) : '—', c.motif],
      null,
    ),
  );

  return (
    <div className="space-y-4">
      {message && <Alerte ton="succes">{message}</Alerte>}

      <BlocAccordeon titre="Prescriptions à examiner" nombre={ordonnances.total} ouvertParDefaut>
        <div className="space-y-4">
          <FiltresServeur
            recherche={{ placeholder: 'Patient, n° de traitement, médicament, établissement…' }}
            periode
            libellePeriode="Prescrite"
            selects={[{ cle: 'contestation', libelle: 'Contestation', options: OPTIONS_CONTESTATION }]}
          />
          <ListeParDossier
            lignes={lignesPrescrites}
            libelleLignes="Lignes prescrites"
            libelleDate="Prescrite le"
            entetesExtra={['Délivrance', 'Contestation']}
            vide="Aucune prescription ne correspond à ces critères."
            avecRecherche={false}
          />
          <PaginationServeur
            page={ordonnances.page}
            pages={ordonnances.pages}
            total={ordonnances.total}
            limite={ordonnances.limite}
          />
        </div>
      </BlocAccordeon>

      <BlocAccordeon titre="Contestations en cours" nombre={enCours.length} ouvertParDefaut>
        <ListeParDossier
          lignes={lignesEnCours}
          libelleLignes="Lignes contestées"
          libelleDate="Ouverte le"
          entetesExtra={['Pharmacie', 'Statut', 'Date limite', 'Réponse']}
          vide="Aucune contestation en cours."
        />
      </BlocAccordeon>

      <BlocAccordeon titre="Contestations traitées" nombre={traitees.length}>
        <ListeParDossier
          lignes={lignesTraitees}
          libelleLignes="Lignes contestées"
          libelleDate="Tranchée le"
          entetesExtra={['Pharmacie', 'Décision', 'Tranchée le', 'Motif']}
          vide="Aucune contestation traitée pour l’instant."
        />
      </BlocAccordeon>
    </div>
  );
}
