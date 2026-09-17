'use client';

import { useRouter } from 'next/navigation';

import {
  ajouterActe,
  ajouterConsultation,
  cloturerDossier,
  definirTypeVisite,
  emettreOrdonnance,
} from '@/app/dashboard-centre-medical/medecin/actions';
import {
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
  CATEGORIES_ACTE,
  ROLES_GESTION_DOSSIER,
  ROLES_ORDONNANCE_DELEGUEE,
  ROLE_MEDECIN_TRAITANT,
  TYPES_VISITE,
  aUnRole,
} from '@/lib/centre-medical';

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
  statut: string;
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
}

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

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
  roleChain,
  actesDisponibles,
}: {
  dossier: DossierComplet;
  moiId: string;
  roleChain: string[];
  actesDisponibles: { id: string; code: string; libelle: string }[];
}) {
  const router = useRouter();

  const ouvert = dossier.statut === 'OUVERT';
  const cloturable = ouvert || dossier.statut === 'SUSPENDU';
  const ticketOuvert = dossier.ticket?.statut === 'OUVERT';

  const suisMedecin = roleChain.includes(ROLE_MEDECIN_TRAITANT);
  const peutGerer = aUnRole(roleChain, ROLES_GESTION_DOSSIER);
  const peutAjouterActe = ouvert && ticketOuvert && peutGerer;

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
      rendu: (c) => <StatutBadge statut={c.statut} />,
    },
  ];

  const colActes: ColonneTable<Acte>[] = [
    { cle: 'libelle', entete: 'Libellé', triable: true },
    {
      cle: 'categorieActe',
      entete: 'Catégorie',
      rendu: (a) => a.categorieActe.replace(/_/g, ' '),
    },
    { cle: 'quantite', entete: 'Qté', aligneDroite: true },
    {
      cle: 'montantPrescrit',
      entete: 'Montant prescrit',
      aligneDroite: true,
      valeur: (a) => Number(a.montantPrescrit ?? 0),
      rendu: (a) => montant(a.montantPrescrit),
    },
    {
      cle: 'ticketModerateurSimule',
      entete: 'Ticket modérateur (simulé)',
      aligneDroite: true,
      valeur: (a) => Number(a.ticketModerateurSimule ?? 0),
      rendu: (a) => montant(a.ticketModerateurSimule),
    },
    {
      cle: 'montantSimulePatient',
      entete: 'Part assuré (simulée)',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimulePatient ?? 0),
      rendu: (a) => montant(a.montantSimulePatient),
    },
    {
      cle: 'montantSimuleAssurance',
      entete: 'Part assurance (simulée)',
      aligneDroite: true,
      valeur: (a) => Number(a.montantSimuleAssurance ?? 0),
      rendu: (a) => montant(a.montantSimuleAssurance),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => <StatutBadge statut={a.statut} />,
    },
  ];

  /** Peut émettre une ordonnance sur CETTE consultation ? */
  function peutOrdonnance(c: Consultation): boolean {
    if (!ouvert) return false;
    if (suisMedecin && c.medecinId === moiId) return true;
    return aUnRole(roleChain, ROLES_ORDONNANCE_DELEGUEE);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N° de traitement">{dossier.numeroTraitement}</Ligne>
          <Ligne label="Statut">
            <StatutBadge statut={dossier.statut} />
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
              <StatutBadge statut={dossier.ticket.statut} />
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
          {ouvert && !suisMedecin && (
            <p className="mb-3 text-sm text-muted-foreground">
              Seul un médecin du centre peut ajouter une consultation.
            </p>
          )}
          <DataTable
            donnees={dossier.consultations}
            cleLigne={(c) => c.id}
            parPage={0}
            colonnes={colConsultations}
            actions={
              ouvert && suisMedecin ? (
                <FormulaireModal
                  titre="Nouvelle consultation"
                  description="Vous êtes enregistré comme médecin de cette consultation."
                  declencheurLabel="Ajouter une consultation"
                  libelleSoumettre="Enregistrer"
                  onSoumettre={async (fd) =>
                    ajouterConsultation(dossier.id, moiId, {
                      motif: String(fd.get('motif') ?? ''),
                      observations:
                        String(fd.get('observations') ?? '') || undefined,
                      diagnostic: String(fd.get('diagnostic') ?? '') || undefined,
                      codeCim10: String(fd.get('codeCim10') ?? '') || undefined,
                    })
                  }
                  onSucces={() => router.refresh()}
                >
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
                    onSoumettre={async (fd) => {
                      const m = fd.get('montantPrescrit');
                      const q = fd.get('quantite');
                      const codeActe = String(fd.get('codeActe') ?? '');
                      return ajouterActe(dossier.id, dossier.ticket!.id, {
                        categorieActe: String(fd.get('categorieActe') ?? ''),
                        libelle: String(fd.get('libelle') ?? ''),
                        codeActe: codeActe || undefined,
                        consultationId: c.id,
                        medecinPrescripteurId: c.medecinId,
                        quantite: q && q !== '' ? Number(q) : undefined,
                        montantPrescrit:
                          m && m !== '' ? Number(m) : undefined,
                      });
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampSelect
                      name="categorieActe"
                      label="Catégorie"
                      required
                      placeholder="Choisir…"
                      options={CATEGORIES_ACTE.map((v) => ({
                        valeur: v,
                        libelle: v.replace(/_/g, ' '),
                      }))}
                    />
                    <ChampTexte
                      name="libelle"
                      label="Libellé de l’acte"
                      required
                      maxLength={300}
                    />
                    {actesDisponibles.length > 0 && (
                      <ChampSelect
                        name="codeActe"
                        label="Acte du référentiel"
                        placeholder="Aucun (montant facturé sans tarif conventionné)"
                        aide="Permet d'appliquer le tarif conventionné de l'établissement, s'il en existe un pour cet acte."
                        options={actesDisponibles.map((a) => ({
                          valeur: a.code,
                          libelle: `${a.libelle} (${a.code})`,
                        }))}
                      />
                    )}
                    <ChampNombre name="quantite" label="Quantité" min={1} defaultValue={1} />
                    <ChampNombre
                      name="montantPrescrit"
                      label="Montant prescrit (F)"
                      min={0}
                      step="0.01"
                      aide="Sert aussi à calculer immédiatement une simulation indicative de remboursement."
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
        <CardHeader>
          <CardTitle className="text-base">Actes du ticket de soins</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Les montants simulés sont indicatifs — le calcul définitif est
            établi par l’adjudication (microservice dédié) à la clôture du
            ticket de soins.
          </p>
          <DataTable
            donnees={dossier.actes}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colActes}
            vide="Aucun acte enregistré."
          />
        </CardContent>
      </Card>

      {/* --- Clôture --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clôture du dossier</CardTitle>
        </CardHeader>
        <CardContent>
          {!cloturable ? (
            <p className="text-sm text-muted-foreground">
              Le dossier est déjà clôturé ({dossier.statut}).
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
    </div>
  );
}
