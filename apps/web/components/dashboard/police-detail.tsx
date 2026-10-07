'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  annulerAvenant,
  appliquerAvenant,
  changerStatut,
  creerAvenant,
  simulerAvenant,
  souscrirePolice,
} from '@/app/dashboard-assureur/informatique/polices/actions';
import type { Simulation } from '@/app/dashboard-assureur/informatique/polices/types';
import {
  ChampNombre,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { LIBELLE_POLICE, TON_POLICE } from '@/lib/police';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Avenant {
  id: string;
  type: string;
  dateEffet: string;
  statut: string;
  proratisationAppliquee: boolean;
  impactCotisation: string | null;
  dateCreation: string;
}
export interface Police {
  id: string;
  numeroPolice: string;
  statut: string;
  dateDebut: string | null;
  dateFin: string | null;
  createdAt: string;
  produit: { nom: string; version: number; statut: string } | null;
  souscripteur: { nom: string; type: string } | null;
  avenants: Avenant[];
}
interface ActionPolice {
  cle: string;
  libelle: string;
  endpoint: 'statut' | 'souscrire';
  statutCible?: string;
  avecDates?: boolean;
  danger?: boolean;
}
export interface ActionsPolice {
  statut: string;
  transitions: string[];
  actions: ActionPolice[];
}

const TYPES_AVENANT = [
  'AJOUT_ADHERENT',
  'RADIATION_ADHERENT',
  'CHANGEMENT_FORMULE',
  'AJOUT_BENEFICIAIRE',
  'MODIFICATION_TARIFAIRE',
  'RESILIATION',
];
const LIBELLE_AVENANT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  APPLIQUE: 'Appliqué',
  ANNULE: 'Annulé',
};

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const montant = (v: string | null) =>
  v === null || v === '' ? '—' : `${Number(v).toLocaleString('fr-FR')} F`;

export function PoliceDetail({
  police,
  actions,
}: {
  police: Police;
  actions: ActionsPolice;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const active = police.statut === 'ACTIVE';

  const transitionStatut = (cible: string) =>
    start(async () => {
      setErreur(null);
      const r = await changerStatut(police.id, cible);
      if (r.ok) router.refresh();
      else setErreur(r.error);
    });

  const colAvenants: ColonneTable<Avenant>[] = [
    { cle: 'type', entete: 'Type', triable: true, rendu: (a) => a.type.replace(/_/g, ' ') },
    {
      cle: 'dateEffet',
      entete: 'Date d’effet',
      triable: true,
      valeur: (a) => a.dateEffet,
      rendu: (a) => dateFr(a.dateEffet),
    },
    {
      cle: 'proratisationAppliquee',
      entete: 'Proratisation',
      rendu: (a) => (a.proratisationAppliquee ? 'Oui' : 'Non'),
    },
    {
      cle: 'impactCotisation',
      entete: 'Impact cotisation',
      aligneDroite: true,
      rendu: (a) => montant(a.impactCotisation),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => (
        <StatutBadge statut={a.statut} libelles={LIBELLE_AVENANT} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {erreur && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}

      {/* --- Informations --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 text-sm sm:grid-cols-2">
          <Ligne label="N° police">{police.numeroPolice}</Ligne>
          <Ligne label="Statut">
            <StatutBadge
              statut={police.statut}
              map={TON_POLICE}
              libelles={LIBELLE_POLICE}
            />
          </Ligne>
          <Ligne label="Souscripteur">{police.souscripteur?.nom ?? '—'}</Ligne>
          <Ligne label="Produit">
            {police.produit
              ? `${police.produit.nom} · v${police.produit.version}`
              : '—'}
          </Ligne>
          <Ligne label="Début">{dateFr(police.dateDebut)}</Ligne>
          <Ligne label="Fin">{dateFr(police.dateFin)}</Ligne>
          <Ligne label="Avenants">{police.avenants.length}</Ligne>
          <Ligne label="Créée le">{dateFr(police.createdAt)}</Ligne>
        </CardContent>
      </Card>

      {/* --- Machine à états : boutons calculés côté API --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cycle de vie</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Transitions valides depuis <b>{LIBELLE_POLICE[actions.statut] ?? actions.statut}</b>{' '}
            (source : <code>GET /policy/polices/:id/actions</code>) :{' '}
            {actions.transitions.length > 0
              ? actions.transitions
                  .map((t) => LIBELLE_POLICE[t] ?? t)
                  .join(', ')
              : 'aucune — statut terminal'}
          </p>

          {actions.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune action disponible : la police est dans un état terminal.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {actions.actions.map((a) =>
                a.endpoint === 'souscrire' ? (
                  <FormulaireModal
                    key={a.cle}
                    titre={a.libelle}
                    mode="center"
                    description="Renseignez la période de couverture. La police passe directement à ACTIVE."
                    declencheur={<Button size="sm">{a.libelle}</Button>}
                    libelleSoumettre={a.libelle}
                    onSoumettre={async (fd) =>
                      souscrirePolice(police.id, {
                        dateDebut: String(fd.get('dateDebut') ?? '') || undefined,
                        dateFin: String(fd.get('dateFin') ?? '') || undefined,
                      })
                    }
                    onSucces={() => router.refresh()}
                  >
                    <ChampTexte
                      name="dateDebut"
                      label="Date de début"
                      type="date"
                      defaultValue={police.dateDebut?.slice(0, 10)}
                    />
                    <ChampTexte
                      name="dateFin"
                      label="Date de fin"
                      type="date"
                      defaultValue={police.dateFin?.slice(0, 10)}
                      aide="Par défaut : début + 1 an."
                    />
                  </FormulaireModal>
                ) : (
                  <Button
                    key={a.cle}
                    size="sm"
                    variant={a.danger ? 'destructive' : 'outline'}
                    disabled={pending}
                    onClick={() => transitionStatut(a.statutCible!)}
                  >
                    {a.libelle}
                  </Button>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Avenants --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Avenants</CardTitle>
        </CardHeader>
        <CardContent>
          {!active && (
            <p className="mb-3 text-sm text-muted-foreground">
              Un avenant ne peut être créé que sur une police <b>ACTIVE</b>.
            </p>
          )}
          <DataTable
            donnees={police.avenants}
            cleLigne={(a) => a.id}
            parPage={0}
            colonnes={colAvenants}
            actions={
              active ? (
                <FormulaireModal
                  titre="Nouvel avenant"
                  description="Calculez la proratisation avant de confirmer."
                  declencheurLabel="Nouvel avenant"
                  libelleSoumettre="Créer l’avenant"
                  onSoumettre={async (fd) => {
                    const tarif = fd.get('tarifMensuelFormule');
                    return creerAvenant(police.id, {
                      type: String(fd.get('type') ?? ''),
                      dateEffet: String(fd.get('dateEffet') ?? ''),
                      tarifMensuelFormule:
                        tarif && tarif !== '' ? Number(tarif) : undefined,
                    });
                  }}
                  onSucces={() => router.refresh()}
                >
                  <AvenantForm policeId={police.id} />
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={
              active
                ? (a) => (
                    <>
                      {a.statut === 'BROUILLON' && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setErreur(null);
                              const r = await appliquerAvenant(police.id, a.id);
                              if (r.ok) router.refresh();
                              else setErreur(r.error);
                            })
                          }
                        >
                          Appliquer
                        </Button>
                      )}
                      {a.statut !== 'ANNULE' && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setErreur(null);
                              const r = await annulerAvenant(police.id, a.id);
                              if (r.ok) router.refresh();
                              else setErreur(r.error);
                            })
                          }
                        >
                          Annuler
                        </Button>
                      )}
                    </>
                  )
                : undefined
            }
            vide="Aucun avenant."
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Champs de l'avenant + aperçu de proratisation (endpoint de simulation). */
function AvenantForm({ policeId }: { policeId: string }) {
  const [type, setType] = useState('AJOUT_ADHERENT');
  const [dateEffet, setDateEffet] = useState('');
  const [tarif, setTarif] = useState('');
  const [sim, setSim] = useState<Simulation | null>(null);
  const [simErr, setSimErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const invalider = () => {
    setSim(null);
    setSimErr(null);
  };

  const simuler = () =>
    start(async () => {
      setSimErr(null);
      setSim(null);
      const r = await simulerAvenant(policeId, {
        type,
        dateEffet,
        tarifMensuelFormule: tarif ? Number(tarif) : undefined,
      });
      if (r.ok) setSim(r.simulation);
      else setSimErr(r.error);
    });

  return (
    <>
      <ChampSelect
        name="type"
        label="Type d’avenant"
        value={type}
        onChange={(e) => {
          setType(e.target.value);
          invalider();
        }}
        options={TYPES_AVENANT.map((t) => ({
          valeur: t,
          libelle: t.replace(/_/g, ' '),
        }))}
      />
      <ChampTexte
        name="dateEffet"
        label="Date d’effet"
        type="date"
        required
        value={dateEffet}
        onChange={(e) => {
          setDateEffet(e.target.value);
          invalider();
        }}
      />
      <ChampNombre
        name="tarifMensuelFormule"
        label="Tarif mensuel de la formule (FCFA)"
        min={0}
        value={tarif}
        onChange={(e) => {
          setTarif(e.target.value);
          invalider();
        }}
        aide="Si renseigné : proratisation = tarif × jours restants ÷ jours total."
      />

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !dateEffet}
          onClick={simuler}
        >
          {pending ? 'Calcul…' : 'Calculer la proratisation'}
        </Button>
        {simErr && <p className="mt-2 text-sm text-destructive">{simErr}</p>}
        {sim && (
          <div className="mt-2 rounded-md border bg-muted/40 p-3 text-sm">
            {sim.proratisationAppliquee ? (
              <>
                <p>
                  <b>{sim.joursRestants}</b> jours restants sur{' '}
                  <b>{sim.joursTotal}</b>&nbsp;({dateFr(sim.periode.dateDebut)} →{' '}
                  {dateFr(sim.periode.dateFin)})
                </p>
                <p className="mt-1">
                  Impact cotisation proratisé :{' '}
                  <b>{montant(sim.impactCotisation)}</b>
                </p>
              </>
            ) : (
              <p>
                Aucune proratisation (tarif non renseigné). Impact :{' '}
                {montant(sim.impactCotisation)}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Ligne({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 sm:border-b sm:last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
