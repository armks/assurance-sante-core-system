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
import { StatutActe } from './statut-acte';
import {
  ChampDateRealisation,
  ChampMedecinRealisateur,
  ChampsNouvelActe,
  lireRealisation,
  type MedecinCentre,
} from './champs-acte';
import { TicketDetail, type DossierFacturation } from './ticket-detail';
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
interface Acte {
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

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function DossierDetail({
  dossier,
  moiId,
  role,
  roleChain,
  medecins = [],
}: {
  dossier: DossierComplet;
  moiId: string;
  /** Rôle exact du compte connecté (pas la chaîne de rôles). */
  role: string;
  roleChain: string[];
  /** Médecins de l'établissement (désignés par l'accueil pour une consultation ou un acte effectué). */
  medecins?: MedecinCentre[];
}) {
  const { libelle: libelleCategorieActe, options: optionsCategories } = useCategoriesActe();
  const router = useRouter();
  /** Retour du dernier ajout d'acte (annonce « catégorie non couverte »). */
  const [avisActe, setAvisActe] = useState<string | null>(null);

  const ouvert = dossier.statut === 'OUVERT';
  const cloturable = ouvert || dossier.statut === 'SUSPENDU';
  const ticketOuvert = dossier.ticket?.statut === 'OUVERT';

  const suisMedecin = roleChain.includes(ROLE_MEDECIN_TRAITANT);
  const peutGerer = aUnRole(roleChain, ROLES_GESTION_DOSSIER);
  const peutAjouterActe = ouvert && ticketOuvert && peutGerer;
  /** L'accueil renseigne la consultation et les actes « sur information du médecin ». */
  const estAccueil = !suisMedecin && roleChain.includes(ROLE_DECLARATION_REALISATION);
  const peutAjouterConsultation = ouvert && (suisMedecin || estAccueil);
  const peutFacturer = aUnRole(roleChain, ROLES_GENERATION_FACTURE);
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
      cle: 'statut',
      entete: 'Statut',
      rendu: (c) => <StatutBadge statut={c.statut} libelles={LIBELLE_STATUT_CONSULTATION} />,
    },
  ];

  const colActes: ColonneTable<Acte>[] = [
    { cle: 'libelle', entete: 'Libellé', triable: true },
    {
      cle: 'categorieActe',
      entete: 'Catégorie',
      valeur: (a) => libelleCategorieActe(a.categorieActe),
      rendu: (a) => libelleCategorieActe(a.categorieActe),
    },
    { cle: 'quantite', entete: 'Qté', aligneDroite: true },
    {
      cle: 'montantPrescrit',
      entete: 'Montant unitaire',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0),
      rendu: (a) => (
        <span title={a.origineMontant === 'TARIF_CONVENTION' ? 'Tarif repris de la convention de l’établissement' : undefined}>
          {montant(a.montantPrescrit)}
          {a.origineMontant === 'TARIF_CONVENTION' && <span className="ml-1 text-xs text-muted-foreground">(convention)</span>}
        </span>
      ),
    },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0) * a.quantite,
      rendu: (a) => (a.montantPrescrit === null || a.montantPrescrit === '' ? '—' : montant(String(Number(a.montantPrescrit) * a.quantite))),
    },
    {
      cle: 'medecinRealisateurId',
      entete: 'Médecin',
      valeur: (a) => nomMedecin(a.medecinRealisateurId),
      rendu: (a) => (
        <span>
          {nomMedecin(a.medecinRealisateurId)}
          {a.realisationDeclareePar && <span className="block text-xs text-muted-foreground">déclaré par l’accueil</span>}
        </span>
      ),
    },
    {
      cle: 'ticketModerateurSimule',
      entete: 'Ticket modérateur (estimation)',
      aligneDroite: true,
      valeur: (a) => Number(a.ticketModerateurSimule ?? 0),
      rendu: (a) => montant(a.ticketModerateurSimule),
    },
    {
      cle: 'montantSimulePatient',
      entete: 'Part assuré (estimation)',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimulePatient ?? 0),
      rendu: (a) => montant(a.montantSimulePatient),
    },
    {
      cle: 'montantSimuleAssurance',
      entete: 'Part assurance (estimation)',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimuleAssurance ?? 0),
      rendu: (a) => montant(a.montantSimuleAssurance),
    },
    {
      cle: 'statutPreautorisation',
      entete: 'Pré-autorisation',
      rendu: (a) =>
        a.statutPreautorisation === 'NON_REQUISE' ? (
          '—'
        ) : (
          <StatutBadge
            statut={a.statutPreautorisation}
            map={TON_PREAUTORISATION}
            libelles={LIBELLE_PREAUTORISATION}
          />
        ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutActe statut={a.statut} dateRealisation={a.dateRealisation} />,
    },
  ];

  /** Rôle EXACT : seul le médecin traitant atteste la réalisation d'un acte. */
  const peutMarquerRealise = role === ROLE_MEDECIN_TRAITANT && dossier.ticket?.statut !== 'ANNULE';
  /** L'accueil déclare la réalisation « sur information du médecin » (médecin désigné, tracé). */
  const peutDeclarerRealise = estAccueil && dossier.ticket?.statut !== 'ANNULE';

  /** Peut émettre une ordonnance sur CETTE consultation ? */
  function peutOrdonnance(c: Consultation): boolean {
    if (!ouvert) return false;
    if (suisMedecin && c.medecinId === moiId) return true;
    return aUnRole(roleChain, ROLES_ORDONNANCE_DELEGUEE);
  }

  return (
    <div className="space-y-6">
      {avisActe && (
        <Alerte
          ton={avisActe.includes('NON COUVERTE') ? 'avertissement' : 'succes'}
          annonce="polie"
        >
          {avisActe}
        </Alerte>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N° de traitement">{dossier.numeroTraitement}</Ligne>
          <Ligne label="Statut">
            <StatutBadge statut={dossier.statut} libelles={LIBELLE_STATUT_DOSSIER} />
          </Ligne>
          <Ligne label="Patient">
            {dossier.beneficiaireId ? 'Bénéficiaire' : 'Adhérent titulaire'}
          </Ligne>
          <Ligne label="Motif d’entrée">
            {dossier.motifConsultation ?? '—'}
          </Ligne>
          <Ligne label="Type de visite">
            {dossier.typeVisite ? (
              TYPES_VISITE.find((t) => t.valeur === dossier.typeVisite)?.libelle ??
              dossier.typeVisite
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
                onSoumettre={async (fd) =>
                  definirTypeVisite(dossier.id, String(fd.get('typeVisite') ?? ''))
                }
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
          </Ligne>
          <Ligne label="Ouvert le">{dateFr(dossier.dateOuverture)}</Ligne>
          {dossier.dateCloture && (
            <Ligne label="Clôturé le">{dateFr(dossier.dateCloture)}</Ligne>
          )}
          <Ligne label="Ticket de soins">
            {dossier.ticket ? (
              <StatutBadge
                statut={dossier.ticket.statut}
                libelles={LIBELLE_STATUT_TICKET}
              />
            ) : (
              '—'
            )}
          </Ligne>
        </CardContent>
      </Card>

      {/* --- Consultations --- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Consultations</CardTitle>
        </CardHeader>
        <CardContent>
          {!ouvert && (
            <p className="mb-3 text-sm text-muted-foreground">
              Le dossier n’est plus ouvert — aucune consultation ne peut être
              ajoutée.
            </p>
          )}
          {ouvert && !peutAjouterConsultation && (
            <p className="mb-3 text-sm text-muted-foreground">
              Seuls le médecin du centre et l’accueil peuvent ajouter une consultation.
            </p>
          )}
          <DataTable
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
                      placeholder={medecins.length > 0 ? 'Choisir le médecin…' : 'Aucun médecin dans cet établissement'}
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
                  <ChampTexte
                    name="codeCim10"
                    label="Code CIM-10"
                    maxLength={20}
                    aide="Optionnel."
                  />
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
                      const lignes = String(fd.get('lignes') ?? '')
                        .split('\n')
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((l) => {
                          const [medicament, posologie, duree] = l
                            .split('|')
                            .map((s) => s.trim());
                          return {
                            medicament: medicament ?? '',
                            posologie: posologie ?? '',
                            duree: duree || undefined,
                          };
                        })
                        .filter((x) => x.medicament && x.posologie);
                      return emettreOrdonnance(dossier.id, {
                        consultationId: c.id,
                        medecinId: c.medecinId,
                        lignes,
                      });
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampZone
                      name="lignes"
                      label="Médicaments"
                      required
                      rows={5}
                      aide="Une ligne par médicament : Nom | Posologie | Durée (optionnelle)"
                      placeholder={
                        'Paracétamol 500mg | 1 cp x3/j | 5 jours\nAmoxicilline 1g | 1 cp x2/j | 7 jours'
                      }
                    />
                  </FormulaireModal>
                )}
              </div>
            )}
            vide="Aucune consultation."
          />
        </CardContent>
      </Card>

      {/* --- Actes --- */}
      <Card>
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
            donnees={dossier.actes}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colActes}
            actionLigne={(a) =>
              (peutMarquerRealise ||
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
              ) : null
            }
            vide="Aucun acte enregistré."
          />
        </CardContent>
      </Card>

      {/* --- Facturation : l'accueil facture les actes réalisés, sans passer par le comptable --- */}
      {peutFacturer && dossier.ticket && (
        <TicketDetail dossier={dossier as unknown as DossierFacturation} peutFacturer />
      )}

      {/* --- Clôture --- */}
      <Card>
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
      <Card>
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
    </div>
  );
}
