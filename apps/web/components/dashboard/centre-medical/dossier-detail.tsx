'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ajouterActeSituation,
  ajouterConsultation,
  cloturerDossier,
  definirTypeVisite,
  emettreOrdonnance,
  marquerActeRealise,
} from '@/app/dashboard-centre-medical/medecin/actions';
import {
  Alerte,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_PREAUTORISATION,
  ROLES_GENERATION_FACTURE,
  ROLES_GESTION_DOSSIER,
  ROLES_ORDONNANCE_DELEGUEE,
  ROLE_DECLARATION_REALISATION,
  ROLE_MEDECIN_TRAITANT,
  TON_PREAUTORISATION,
  TYPES_VISITE,
  aUnRole,
} from '@/lib/centre-medical';
import { ChampCim10 } from './champ-cim10';
import { FichePatient } from './fiche-patient';
import { OrdonnancesDossier, type OrdonnanceDossier } from './ordonnances-dossier';
import { StatutActe } from './statut-acte';
import {
  ChampDateRealisation,
  ChampMedecinRealisateur,
  ChampsNouvelActe,
  lireRealisation,
  type MedecinCentre,
} from './champs-acte';
import { TicketDetail, type DossierFacturation } from './ticket-detail';
import { ChampsMedicamentsOrdonnance, lireLignesOrdonnance } from './champs-medicaments';
import {
  LIBELLE_STATUT_CONSULTATION,
  LIBELLE_STATUT_DOSSIER,
  LIBELLE_STATUT_TICKET,
} from '@/lib/dossier-soins';
import { useCategoriesActe } from '@/components/categories-acte';

interface Consultation {
  id: string;
  numeroConsultation: string;
  medecinId: string;
  motif: string | null;
  diagnostic: string | null;
  statut: string;
  dateConsultation: string;
}
export interface Acte {
  id: string;
  libelle: string;
  categorieActe: string;
  codeActe: string | null;
  quantite: number;
  montantPrescrit: string | null;
  montantSimuleAssurance: string | null;
  montantSimulePatient: string | null;
  ticketModerateurSimule: string | null;
  statutPreautorisation: string;
  statut: string;
  dateRealisation: string | null;
  /** Médecin qui a effectué l'acte ; compte d'accueil qui l'a déclaré ; origine du montant (prisma/sql/089). */
  medecinRealisateurId?: string | null;
  realisationDeclareePar?: string | null;
  origineMontant?: 'SAISI' | 'TARIF_CONVENTION' | null;
}
interface NoteDossier {
  id: string;
  contenu: string;
  createdAt: string;
  acteDossierId: string | null;
  auteur: { role: string | null } | null;
}
export interface PatientDossier {
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: string | null;
  numeroCarte: string | null;
  /** Société de l'adhérent (souscripteur). */
  societe: string | null;
  /** URL signée (éphémère) de la photo ; `null` si aucune. */
  photoUrl: string | null;
  /** `TITULAIRE` ou lien de parenté du bénéficiaire (CONJOINT, ENFANT…). */
  lien: string;
  /** Formule d'assurance (produit de la police). */
  formule: string | null;
}
export interface DossierComplet {
  id: string;
  numeroTraitement: string;
  statut: string;
  motifConsultation: string | null;
  diagnosticEntree: string | null;
  dateOuverture: string;
  dateCloture: string | null;
  adherentId: string | null;
  beneficiaireId: string | null;
  typeVisite: string | null;
  consultations: Consultation[];
  actes: Acte[];
  ordonnances?: OrdonnanceDossier[];
  patient?: PatientDossier | null;
  ticket: { id: string; statut: string } | null;
  notes: NoteDossier[];
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const dateHeureFr = (d: string) => new Date(d).toLocaleString('fr-FR');
const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

/** Pré-autorisation en cours ou refusée : l'acte n'est pas encore à effectuer / à déclarer réalisé (miroir de l'API). */
const PREAUTORISATION_BLOQUANTE = ['EN_ATTENTE_EXPLOITATION', 'EN_ATTENTE_MEDECIN_CONSEIL', 'REFUSEE'];

/** Libellé au-dessus, valeur dessous — cellule d'une grille d'informations compacte. */
function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function DossierDetail({
  dossier,
  moiId,
  role,
  roleChain,
  medecins = [],
  tarifConsultation = null,
  partsConsultation = null,
  lectureSeule = false,
  actionActe,
  pied,
}: {
  dossier: DossierComplet;
  moiId: string;
  /** Rôle exact du compte connecté (pas la chaîne de rôles). */
  role: string;
  roleChain: string[];
  /** Médecins de l'établissement (désignés par l'accueil pour une consultation ou un acte effectué). */
  medecins?: MedecinCentre[];
  /** Tarif d'une consultation selon la convention de l'établissement (F), `null` si indisponible. */
  tarifConsultation?: number | null;
  /** Répartition du tarif d'une consultation entre l'assurance et l'assuré (F, par consultation) ; `null` si le calcul est indisponible. */
  partsConsultation?: { assurance: number; assure: number } | null;
  /** Vue du personnel de l'assurance : aucune écriture du parcours de soins (ajout, réalisation, facturation, clôture du centre). */
  lectureSeule?: boolean;
  /** Action supplémentaire par acte (ex. décision de pré-autorisation de l'assurance). */
  actionActe?: (a: Acte) => React.ReactNode;
  /** Remplace les cartes « Clôture » et « Notes » (clôture forcée et notes de l'assurance). */
  pied?: React.ReactNode;
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  /** Retour du dernier ajout d'acte (annonce « catégorie non couverte »). */
  const [avisActe, setAvisActe] = useState<string | null>(null);

  const ouvert = dossier.statut === 'OUVERT';
  const cloturable = ouvert || dossier.statut === 'SUSPENDU';
  const ticketOuvert = dossier.ticket?.statut === 'OUVERT';

  const suisMedecin = !lectureSeule && roleChain.includes(ROLE_MEDECIN_TRAITANT);
  const peutGerer = !lectureSeule && aUnRole(roleChain, ROLES_GESTION_DOSSIER);
  const peutAjouterActe = ouvert && ticketOuvert && peutGerer;
  /** L'accueil renseigne la consultation et les actes « sur information du médecin ». */
  const estAccueil = !lectureSeule && !suisMedecin && roleChain.includes(ROLE_DECLARATION_REALISATION);
  const peutAjouterConsultation = ouvert && (suisMedecin || estAccueil);
  const peutFacturer = !lectureSeule && aUnRole(roleChain, ROLES_GENERATION_FACTURE);
  const nomMedecin = (id: string | null | undefined) =>
    id ? (medecins.find((m) => m.id === id)?.libelle ?? (id === moiId ? 'Moi' : 'Médecin du centre')) : '—';

  /**
   * Ajout d'un acte (formulaire commun). `consultation` : celle de la ligne depuis laquelle on ajoute ; à défaut (bouton général), la
   * consultation éventuellement choisie dans le formulaire — son médecin devient le prescripteur, sinon le médecin connecté.
   */
  async function soumettreActe(fd: FormData, consultation?: Consultation) {
    // montant repris de la convention et non modifié : on ne l'envoie pas, l'API le résout elle-même (origine tracée)
    const m = fd.get('montantAuto') === '1' ? null : fd.get('montantPrescrit');
    const q = fd.get('quantite');
    const codeActe = String(fd.get('codeActe') ?? '');
    const choisie =
      consultation ?? dossier.consultations.find((x) => x.id === String(fd.get('consultationId') ?? '')) ?? undefined;
    return ajouterActeSituation(
      dossier.id,
      dossier.ticket!.id,
      {
        categorieActe: String(fd.get('categorieActe') ?? ''),
        libelle: String(fd.get('libelle') ?? ''),
        codeActe: codeActe || undefined,
        consultationId: choisie?.id,
        medecinPrescripteurId: choisie?.medecinId ?? (suisMedecin ? moiId : undefined),
        quantite: q && q !== '' ? Number(q) : undefined,
        montantPrescrit: m && m !== '' ? Number(m) : undefined,
      },
      String(fd.get('situation') ?? 'A_EFFECTUER') as 'A_EFFECTUER' | 'PROPOSE' | 'EFFECTUE',
      lireRealisation(fd),
    );
  }

  const colConsultations: ColonneTable<Consultation>[] = [
    { cle: 'numeroConsultation', entete: 'N°', triable: true },
    { cle: 'motif', entete: 'Motif', rendu: (c) => c.motif ?? '—' },
    { cle: 'diagnostic', entete: 'Diagnostic', rendu: (c) => c.diagnostic ?? '—' },
    {
      cle: 'dateConsultation',
      entete: 'Date',
      triable: true,
      valeur: (c) => c.dateConsultation,
      rendu: (c) => dateFr(c.dateConsultation),
    },
    {
      cle: 'cout',
      entete: 'Coût (convention)',
      aligneDroite: true,
      valeur: () => tarifConsultation ?? 0,
      rendu: (c) =>
        c.statut !== 'ANNULEE' && tarifConsultation !== null ? (
          <span title="Tarif de la consultation selon la convention de l’établissement">{montant(String(tarifConsultation))}</span>
        ) : (
          '—'
        ),
    },
    {
      cle: 'partAssureConsultation',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: () => partsConsultation?.assure ?? 0,
      rendu: (c) =>
        c.statut !== 'ANNULEE' && partsConsultation ? (
          <span title="Part de la consultation à la charge de l’assuré (ticket modérateur compris)">{montant(String(partsConsultation.assure))}</span>
        ) : (
          '—'
        ),
    },
    {
      cle: 'partAssuranceConsultation',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: () => partsConsultation?.assurance ?? 0,
      rendu: (c) =>
        c.statut !== 'ANNULEE' && partsConsultation ? (
          <span className="font-medium text-emerald-700 dark:text-emerald-300" title="Part de la consultation prise en charge par l’assurance">
            {montant(String(partsConsultation.assurance))}
          </span>
        ) : (
          '—'
        ),
    },
    {
      cle: 'ordonnances',
      entete: 'Ordonnances',
      aligneDroite: true,
      valeur: (c) => (dossier.ordonnances ?? []).filter((o) => o.consultationId === c.id).length,
      rendu: (c) => (dossier.ordonnances ?? []).filter((o) => o.consultationId === c.id).length || '—',
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} libelles={LIBELLE_STATUT_CONSULTATION} />,
    },
  ];

  const ordonnances = dossier.ordonnances ?? [];
  const consultationsFacturables = dossier.consultations.filter((c) => c.statut !== 'ANNULEE').length;

  // Montant final estimé du dossier : consultations (tarif de la convention) + actes non refusés ni annulés, réparti entre assuré et assurance
  const actesComptes = dossier.actes.filter((a) => a.statutPreautorisation !== 'REFUSEE' && a.statut !== 'ANNULE');
  const totalActes = actesComptes.reduce((s, a) => s + Number(a.montantPrescrit ?? 0) * a.quantite, 0);
  const assureActes = actesComptes.reduce((s, a) => s + Number(a.montantSimulePatient ?? 0), 0);
  const assuranceActes = actesComptes.reduce((s, a) => s + Number(a.montantSimuleAssurance ?? 0), 0);
  const aConsultationsChiffrees = tarifConsultation !== null && consultationsFacturables > 0;
  const totalConsultations = aConsultationsChiffrees ? tarifConsultation! * consultationsFacturables : 0;
  const assureConsultations = aConsultationsChiffrees && partsConsultation ? partsConsultation.assure * consultationsFacturables : 0;
  const assuranceConsultations = aConsultationsChiffrees && partsConsultation ? partsConsultation.assurance * consultationsFacturables : 0;
  const totalDossier = totalConsultations + totalActes;
  const assureDossier = assureConsultations + assureActes;
  const assuranceDossier = assuranceConsultations + assuranceActes;
  const aMontants = totalDossier > 0;

  /** La colonne « Pré-autorisation » n'apparaît que si au moins un acte en relève (sinon elle ne contient que des tirets). */
  const aPreautorisation = dossier.actes.some((a) => a.statutPreautorisation !== 'NON_REQUISE');

  const colActes: ColonneTable<Acte>[] = [
    {
      cle: 'libelle',
      entete: 'Acte',
      triable: true,
      rendu: (a) => (
        <span className="inline-flex items-center gap-2" title={`${libelleCategorieActe(a.categorieActe)}${a.codeActe ? ` · ${a.codeActe}` : ''}`}>
          <span className="font-medium">{a.libelle}</span>
          {a.codeActe && <span className="font-mono text-xs text-muted-foreground">{a.codeActe}</span>}
        </span>
      ),
    },
    { cle: 'quantite', entete: 'Qté', aligneDroite: true, className: 'tabular-nums' },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0) * a.quantite,
      rendu: (a) =>
        a.montantPrescrit === null || a.montantPrescrit === '' ? (
          '—'
        ) : (
          <span className="inline-flex items-center justify-end gap-2">
            {a.origineMontant === 'TARIF_CONVENTION' && (
              <span
                className="rounded-full bg-emerald-50 px-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                title="Tarif repris de la convention de l’établissement"
              >
                convention
              </span>
            )}
            {a.quantite > 1 && <span className="text-xs text-muted-foreground">{montant(a.montantPrescrit)} × {a.quantite}</span>}
            <span className="font-semibold">{montant(String(Number(a.montantPrescrit) * a.quantite))}</span>
          </span>
        ),
    },
    {
      cle: 'medecinRealisateurId',
      entete: 'Médecin',
      valeur: (a) => nomMedecin(a.medecinRealisateurId),
      rendu: (a) => (
        <span>
          {nomMedecin(a.medecinRealisateurId)}
          {a.realisationDeclareePar && <span className="text-xs text-muted-foreground"> · accueil</span>}
        </span>
      ),
    },
    {
      cle: 'montantSimulePatient',
      entete: 'Part assuré',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimulePatient ?? 0),
      rendu: (a) => <span title={a.ticketModerateurSimule ? `dont ticket modérateur ${montant(a.ticketModerateurSimule)}` : undefined}>{montant(a.montantSimulePatient)}</span>,
    },
    {
      cle: 'montantSimuleAssurance',
      entete: 'Part assurance',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimuleAssurance ?? 0),
      rendu: (a) => <span className="font-medium text-emerald-700 dark:text-emerald-300">{montant(a.montantSimuleAssurance)}</span>,
    },
    ...(aPreautorisation
      ? [
          {
            cle: 'statutPreautorisation',
            entete: 'Pré-autorisation',
            rendu: (a: Acte) =>
              a.statutPreautorisation === 'NON_REQUISE' ? (
                '—'
              ) : (
                <StatutBadge statut={a.statutPreautorisation} map={TON_PREAUTORISATION} libelles={LIBELLE_PREAUTORISATION} />
              ),
          } satisfies ColonneTable<Acte>,
        ]
      : []),
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutActe statut={a.statut} dateRealisation={a.dateRealisation} surUneLigne />,
    },
  ];

  /** Rôle EXACT : seul le médecin traitant atteste la réalisation d'un acte. */
  const peutMarquerRealise = !lectureSeule && role === ROLE_MEDECIN_TRAITANT && dossier.ticket?.statut !== 'ANNULE';
  /** L'accueil déclare la réalisation « sur information du médecin » (médecin désigné, tracé). */
  const peutDeclarerRealise = estAccueil && dossier.ticket?.statut !== 'ANNULE';

  /** Peut émettre une ordonnance sur CETTE consultation ? */
  function peutOrdonnance(c: Consultation): boolean {
    if (!ouvert) return false;
    if (suisMedecin && c.medecinId === moiId) return true;
    return aUnRole(roleChain, ROLES_ORDONNANCE_DELEGUEE);
  }

  return (
    <div className="space-y-3">
      {avisActe && (
        <Alerte
          ton={avisActe.includes('NON COUVERTE') ? 'avertissement' : 'succes'}
          annonce="polie"
        >
          {avisActe}
        </Alerte>
      )}
      <Card className="gap-0 py-3">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-5">
          {dossier.patient && <FichePatient patient={dossier.patient} />}
          {/* 3 lignes : identification du dossier / visite et dates / motif */}
          <dl className="grid flex-1 content-between gap-y-2.5">
            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              <Info label="N° de traitement">{dossier.numeroTraitement}</Info>
              <Info label="Statut">
                <StatutBadge statut={dossier.statut} libelles={LIBELLE_STATUT_DOSSIER} />
              </Info>
              <Info label="Ticket de soins">
                {dossier.ticket ? <StatutBadge statut={dossier.ticket.statut} libelles={LIBELLE_STATUT_TICKET} /> : '—'}
              </Info>
            </div>
            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              <Info label="Type de visite">
                {dossier.typeVisite ? (
                  TYPES_VISITE.find((t) => t.valeur === dossier.typeVisite)?.libelle ?? dossier.typeVisite
                ) : ouvert && peutGerer ? (
                  <FormulaireModal
                    titre="Choisir le type de visite"
                    mode="center"
                    description="Choix définitif — un seul choix possible par dossier."
                    declencheur={
                      <Button type="button" size="xs" variant="outline">
                        Définir
                      </Button>
                    }
                    libelleSoumettre="Enregistrer"
                    onSoumettre={async (fd) => definirTypeVisite(dossier.id, String(fd.get('typeVisite') ?? ''))}
                    onSucces={() => router.refresh()}
                  >
                    <ChampSelect
                      name="typeVisite"
                      label="Type de visite"
                      required
                      placeholder="Choisir…"
                      options={TYPES_VISITE.map((t) => ({ valeur: t.valeur, libelle: t.libelle }))}
                    />
                  </FormulaireModal>
                ) : (
                  '—'
                )}
              </Info>
              <Info label="Ouvert le">{dateFr(dossier.dateOuverture)}</Info>
              {dossier.dateCloture && <Info label="Clôturé le">{dateFr(dossier.dateCloture)}</Info>}
            </div>
            <div className="grid">
              <Info label="Motif d’entrée">{dossier.motifConsultation ?? '—'}</Info>
            </div>
            {aMontants && (
              <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3" data-testid="montants-dossier">
                <Info label="Coût estimé des soins">
                  <span className="font-semibold" title="Consultations (tarif de la convention) et actes, hors actes refusés ou annulés">{montant(String(totalDossier))}</span>
                </Info>
                <Info label="Part assuré">
                  <span className="font-semibold">{montant(String(assureDossier))}</span>
                </Info>
                <Info label="Part assurance">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">{montant(String(assuranceDossier))}</span>
                </Info>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* --- Consultations --- */}
      <Card className="gap-2 py-3">
        <CardHeader className="flex flex-row items-center justify-between gap-1">
          <CardTitle className="text-base">Consultations</CardTitle>
        </CardHeader>
        <CardContent>
          {!ouvert && !lectureSeule && (
            <p className="mb-3 text-sm text-muted-foreground">
              Le dossier n’est plus ouvert — aucune consultation ne peut être
              ajoutée.
            </p>
          )}
          {ouvert && !lectureSeule && !peutAjouterConsultation && (
            <p className="mb-3 text-sm text-muted-foreground">
              Seuls le médecin du centre et l’accueil peuvent ajouter une consultation.
            </p>
          )}
          <DataTable
            compact
            donnees={dossier.consultations}
            cleLigne={(c) => c.id}
            parPage={0}
            colonnes={colConsultations}
            actions={
              peutAjouterConsultation ? (
                <FormulaireModal
                  titre="Nouvelle consultation"
                  description={
                    suisMedecin
                      ? 'Vous êtes enregistré comme médecin de cette consultation.'
                      : 'Renseignez la consultation sur information du médecin : il est enregistré comme médecin de cette consultation.'
                  }
                  declencheurLabel="Ajouter une consultation"
                  libelleSoumettre="Enregistrer"
                  onSoumettre={async (fd) =>
                    ajouterConsultation(dossier.id, suisMedecin ? moiId : String(fd.get('medecinId') ?? ''), {
                      motif: String(fd.get('motif') ?? ''),
                      observations:
                        String(fd.get('observations') ?? '') || undefined,
                      diagnostic: String(fd.get('diagnostic') ?? '') || undefined,
                      codeCim10: String(fd.get('codeCim10') ?? '') || undefined,
                    })
                  }
                  onSucces={() => router.refresh()}
                >
                  {estAccueil && (
                    <ChampSelect
                      name="medecinId"
                      label="Médecin de la consultation"
                      required
                      placeholder={medecins.length > 0 ? 'Choisir le médecin…' : 'Aucun médecin n’a renseigné son nom (Mon profil)'}
                      options={medecins.map((m) => ({ valeur: m.id, libelle: m.libelle }))}
                    />
                  )}
                  <ChampTexte name="motif" label="Motif" required maxLength={300} />
                  <ChampZone
                    name="observations"
                    label="Observations"
                    maxLength={2000}
                  />
                  <ChampTexte
                    name="diagnostic"
                    label="Diagnostic"
                    maxLength={500}
                  />
                  <ChampCim10 />
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={(c) => (
              <div className="flex gap-1">
                {peutAjouterActe && (
                  <FormulaireModal
                    titre="Ajouter un acte"
                    description={`Rattaché à la consultation ${c.numeroConsultation}.`}
                    mode="center"
                    declencheur={
                      <Button size="xs" variant="ghost">
                        + Acte
                      </Button>
                    }
                    libelleSoumettre="Ajouter l’acte"
                    onSoumettre={(fd) => soumettreActe(fd, c)}
                    onSucces={(message) => {
                      setAvisActe(message ?? null);
                      router.refresh();
                    }}
                  >
                    <ChampsNouvelActe
                      dossierId={dossier.id}
                      categories={optionsCategories()}
                      estAccueil={estAccueil}
                      medecins={medecins}
                      typeVisite={dossier.typeVisite}
                    />
                  </FormulaireModal>
                )}
                {peutOrdonnance(c) && (
                  <FormulaireModal
                    titre="Émettre une ordonnance"
                    description="Le code de retrait sera envoyé directement à l’adhérent (APP/SMS) — il ne s’affiche pas ici."
                    declencheur={
                      <Button size="xs" variant="ghost">
                        + Ordonnance
                      </Button>
                    }
                    libelleSoumettre="Établir l’ordonnance"
                    onSoumettre={async (fd) => {
                      const lues = lireLignesOrdonnance(fd);
                      if (!lues.ok) return { ok: false, error: lues.error, erreurs: [] };
                      return emettreOrdonnance(dossier.id, {
                        consultationId: c.id,
                        medecinId: c.medecinId,
                        lignes: lues.lignes,
                      });
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampsMedicamentsOrdonnance />
                  </FormulaireModal>
                )}
              </div>
            )}
            vide="Aucune consultation."
          />
        </CardContent>
      </Card>

      {/* --- Ordonnances émises --- */}
      <Card className="gap-2 py-3">
        <CardHeader>
          <CardTitle className="text-base">Ordonnances ({ordonnances.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tarifConsultation !== null && consultationsFacturables > 0 && (
            <p className="text-sm text-muted-foreground">
              Consultations selon la convention : {consultationsFacturables} × {montant(String(tarifConsultation))} ={' '}
              <strong className="text-foreground">{montant(String(tarifConsultation * consultationsFacturables))}</strong>
              {partsConsultation && (
                <>
                  {' '}— dont part assuré <strong className="text-foreground">{montant(String(assureConsultations))}</strong> et part assurance{' '}
                  <strong className="text-emerald-700 dark:text-emerald-300">{montant(String(assuranceConsultations))}</strong>
                </>
              )}
            </p>
          )}
          <OrdonnancesDossier
            ordonnances={ordonnances}
            numeroConsultation={(id) => dossier.consultations.find((c) => c.id === id)?.numeroConsultation ?? null}
            nomMedecin={nomMedecin}
          />
        </CardContent>
      </Card>

      {/* --- Actes --- */}
      <Card className="gap-2 py-3">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Actes du ticket de soins</CardTitle>
          {peutAjouterActe && (
            <FormulaireModal
              titre="Ajouter un acte de soins"
              description="Consultation, analyse, examen, hospitalisation, soin… — effectué, à effectuer, ou proposé à l’assurance pour validation avant exécution."
              mode="center"
              declencheurLabel="Ajouter un acte de soins"
              libelleSoumettre="Ajouter l’acte"
              onSoumettre={(fd) => soumettreActe(fd)}
              onSucces={(message) => {
                setAvisActe(message ?? null);
                router.refresh();
              }}
            >
              {dossier.consultations.length > 0 && (
                <ChampSelect
                  name="consultationId"
                  label="Consultation rattachée"
                  defaultValue={dossier.consultations[dossier.consultations.length - 1].id}
                  options={[
                    { valeur: '', libelle: 'Aucune (acte du dossier)' },
                    ...dossier.consultations.map((c) => ({ valeur: c.id, libelle: `${c.numeroConsultation} — ${c.motif ?? 'sans motif'}` })),
                  ]}
                  aide="Facultatif : rattache l’acte à une consultation du dossier."
                />
              )}
              <ChampsNouvelActe
                dossierId={dossier.id}
                categories={optionsCategories()}
                estAccueil={estAccueil}
                medecins={medecins}
                typeVisite={dossier.typeVisite}
              />
            </FormulaireModal>
          )}
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            <strong>Estimation, calculée au jour de la facture</strong> : ces montants sont indicatifs, calculés à
            l’ajout de l’acte sans connaître la date des soins ni le tarif
            définitif. Le calcul définitif est établi par le microservice
            d’adjudication à la facturation, à la date des soins.
          </p>
          <DataTable
            compact
            donnees={dossier.actes}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colActes}
            actionLigne={(a) => (
              <div className="flex items-center justify-end gap-1">
                {actionActe?.(a)}
                {(peutMarquerRealise ||
                (peutDeclarerRealise && !PREAUTORISATION_BLOQUANTE.includes(a.statutPreautorisation))) &&
              a.statut === 'PRESCRIT' ? (
                <FormulaireModal
                  titre={estAccueil ? 'Déclarer l’acte réalisé' : 'Marquer l’acte comme réalisé'}
                  mode="center"
                  description={`« ${a.libelle} » — un acte n’est facturable qu’une fois réalisé. ${estAccueil ? 'Vous déclarez sur information du médecin désigné' : 'Cette attestation'} : tracé dans l’audit.`}
                  declencheur={
                    <Button type="button" size="xs" variant="outline">
                      {estAccueil ? 'Déclarer réalisé' : 'Marquer comme réalisé'}
                    </Button>
                  }
                  libelleSoumettre="Confirmer la réalisation"
                  onSoumettre={async (fd) => {
                    // datetime-local = heure locale du poste → ISO avec fuseau.
                    const r = lireRealisation(fd);
                    return marquerActeRealise(dossier.id, a.id, r.dateRealisation, estAccueil ? r.medecinId : undefined);
                  }}
                  onSucces={() => router.refresh()}
                >
                  {estAccueil && <ChampMedecinRealisateur medecins={medecins} />}
                  <ChampDateRealisation />
                </FormulaireModal>
              ) : null}
              </div>
            )}
            vide="Aucun acte enregistré."
          />
          {actesComptes.length > 0 && (
            <dl className="mt-3 grid gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3" data-testid="montant-final-actes" aria-label="Montant final des actes">
              <div>
                <dt className="text-xs text-muted-foreground">Montant final des actes</dt>
                <dd className="text-base font-semibold tabular-nums">{montant(String(totalActes))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Part assuré</dt>
                <dd className="text-base font-semibold tabular-nums">{montant(String(assureActes))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Part assurance</dt>
                <dd className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{montant(String(assuranceActes))}</dd>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-3">Hors actes refusés ou annulés. Estimation : le calcul définitif est établi à la facturation.</p>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* --- Facturation : l'accueil facture les actes réalisés, sans passer par le comptable --- */}
      {peutFacturer && dossier.ticket && (
        <TicketDetail dossier={dossier as unknown as DossierFacturation} peutFacturer />
      )}

      {pied ?? (
      <>
      {/* --- Clôture --- */}
      <Card className="gap-2 py-3">
        <CardHeader>
          <CardTitle className="text-base">Clôture du dossier</CardTitle>
        </CardHeader>
        <CardContent>
          {!cloturable ? (
            <p className="text-sm text-muted-foreground">
              Le dossier est déjà clôturé ({LIBELLE_STATUT_DOSSIER[dossier.statut] ?? dossier.statut}).
            </p>
          ) : !peutGerer ? (
            <p className="text-sm text-muted-foreground">
              Votre rôle ne permet pas de clôturer un dossier de soins.
            </p>
          ) : (
            <FormulaireModal
              titre="Clôturer le dossier"
              mode="center"
              description="La clôture verrouille définitivement l’ajout d’actes (le ticket de soins passe à CLÔTURÉ)."
              declencheur={<Button variant="destructive">Clôturer le dossier</Button>}
              libelleSoumettre="Confirmer la clôture"
              onSoumettre={async (fd) => {
                const r = await cloturerDossier(dossier.id, {
                  motif: String(fd.get('motif') ?? '') || undefined,
                });
                if (!r.ok) return { ok: false, error: r.error, erreurs: [] };
                return { ok: true, message: 'Dossier clôturé.' };
              }}
              onSucces={() => router.refresh()}
            >
              <ChampTexte
                name="motif"
                label="Motif de clôture"
                maxLength={500}
                aide="Optionnel."
              />
            </FormulaireModal>
          )}
        </CardContent>
      </Card>

      {/* --- Notes (lecture seule — écriture réservée à l'assureur) --- */}
      <Card className="gap-2 py-3">
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {dossier.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune note pour l’instant.</p>
          ) : (
            <ul className="space-y-3">
              {dossier.notes.map((n) => (
                <li key={n.id} className="rounded-md border p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.contenu}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.auteur?.role ?? 'Rôle inconnu'} · {dateHeureFr(n.createdAt)}
                    {n.acteDossierId && ' · liée à un acte précis'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </>
      )}
    </div>
  );
}
