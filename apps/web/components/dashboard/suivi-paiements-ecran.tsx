'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  associerFacturesPourPaiement,
  decocherLigneContestee,
  marquerPaiementGroupePaye,
  obtenirDetailFacture,
  validerPourPaiementGlobal,
  type LigneFactureDetail,
} from '@/app/dashboard-assureur/paiements-actions';
import { DataTable, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface FactureGlobale {
  id: string;
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE';
  beneficiaireNom: string;
  periode: string;
  statut: string;
  montantTotal: string;
  nbLignesReportees: number;
  dateSoumission: string | null;
  dateVerification: string | null;
  dateProgrammation: string | null;
  datePaiement: string | null;
  societes: string[];
  patients: string[];
  categoriesActe: string[];
}

export interface PaiementGroupeResume {
  id: string;
  beneficiaireType: 'ETABLISSEMENT' | 'PHARMACIE';
  beneficiaireNom: string;
  montantTotal: string;
  nbFactures: number;
  dateProgrammee: string;
  datePaiement: string | null;
  statut: string;
}

const LIBELLE_STATUT: Record<string, string> = {
  EN_PREPARATION: 'En préparation',
  SOUMISE: 'Soumise',
  VERIFIEE_MEDECIN_CONSEIL: 'Vérifiée',
  VALIDEE_PHARMACIEN_CONSEIL: 'Validée',
  PROGRAMMEE_PAIEMENT: 'En paiement',
  PAYEE: 'Payée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EN_PREPARATION: 'neutre',
  SOUMISE: 'attention',
  VERIFIEE_MEDECIN_CONSEIL: 'attention',
  VALIDEE_PHARMACIEN_CONSEIL: 'attention',
  PROGRAMMEE_PAIEMENT: 'attention',
  PAYEE: 'succes',
};
const STATUTS_VERIFIES = ['VERIFIEE_MEDECIN_CONSEIL', 'VALIDEE_PHARMACIEN_CONSEIL'];

const montant = (v: string) => `${Number(v).toLocaleString('fr-FR')} F`;
const moisFr = (d: string) =>
  new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const periodeCle = (d: string) => d.slice(0, 10).slice(0, 7);

function optionsUniques(valeurs: string[]) {
  return [...new Set(valeurs)].sort((a, b) => a.localeCompare(b, 'fr'));
}

function Selecteur({
  libelle,
  valeur,
  options,
  onChange,
}: {
  libelle: string;
  valeur: string;
  options: { valeur: string; libelle: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      aria-label={libelle}
    >
      <option value="">{libelle} : tous</option>
      {options.map((o) => (
        <option key={o.valeur} value={o.valeur}>
          {o.libelle}
        </option>
      ))}
    </select>
  );
}

export function SuiviPaiementsEcran({
  facturesInitiales,
  paiementsGroupesInitiaux,
  cible,
}: {
  facturesInitiales: FactureGlobale[];
  paiementsGroupesInitiaux: PaiementGroupeResume[];
  cible: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [filtreBeneficiaire, setFiltreBeneficiaire] = useState('');
  const [filtreSociete, setFiltreSociete] = useState('');
  const [filtreTypeActe, setFiltreTypeActe] = useState('');
  const [filtreAdherent, setFiltreAdherent] = useState('');
  const [filtrePeriode, setFiltrePeriode] = useState('');
  const [detail, setDetail] = useState<{ facture: FactureGlobale; lignes: LigneFactureDetail[] } | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  function succes(msg: string) {
    setMessage({ ok: true, texte: msg });
    router.refresh();
  }
  function echec(msg: string) {
    setMessage({ ok: false, texte: msg });
  }

  const optBeneficiaires = optionsUniques(facturesInitiales.map((f) => f.beneficiaireNom));
  const optSocietes = optionsUniques(facturesInitiales.flatMap((f) => f.societes));
  const optTypesActe = optionsUniques(facturesInitiales.flatMap((f) => f.categoriesActe));
  const optAdherents = optionsUniques(facturesInitiales.flatMap((f) => f.patients));
  const optPeriodes = optionsUniques(facturesInitiales.map((f) => periodeCle(f.periode)));

  const facturesFiltrees = useMemo(() => {
    return facturesInitiales.filter((f) => {
      if (filtreBeneficiaire && f.beneficiaireNom !== filtreBeneficiaire) return false;
      if (filtreSociete && !f.societes.includes(filtreSociete)) return false;
      if (filtreTypeActe && !f.categoriesActe.includes(filtreTypeActe)) return false;
      if (filtreAdherent && !f.patients.includes(filtreAdherent)) return false;
      if (filtrePeriode && periodeCle(f.periode) !== filtrePeriode) return false;
      return true;
    });
  }, [facturesInitiales, filtreBeneficiaire, filtreSociete, filtreTypeActe, filtreAdherent, filtrePeriode]);

  const donneesChart = useMemo(() => {
    const parPeriode = new Map<string, number>();
    for (const f of facturesFiltrees) {
      const cle = periodeCle(f.periode);
      parPeriode.set(cle, (parPeriode.get(cle) ?? 0) + Number(f.montantTotal));
    }
    return [...parPeriode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periode, montantTotal]) => ({ periode, montantTotal }));
  }, [facturesFiltrees]);

  // La plus récente période présente dans l'ensemble NON filtré — « Factures du mois ».
  const periodePlusRecente = optionsUniques(facturesInitiales.map((f) => periodeCle(f.periode))).at(-1);

  const duMois = facturesFiltrees.filter((f) => periodeCle(f.periode) === periodePlusRecente);
  const enPaiement = facturesFiltrees.filter((f) => f.statut === 'PROGRAMMEE_PAIEMENT');
  const partiellementReglees = facturesFiltrees.filter((f) => f.statut === 'PAYEE' && f.nbLignesReportees > 0);
  const reglees = facturesFiltrees.filter((f) => f.statut === 'PAYEE' && f.nbLignesReportees === 0);
  const impayees = facturesFiltrees.filter((f) => !['PROGRAMMEE_PAIEMENT', 'PAYEE'].includes(f.statut));

  async function ouvrirDetail(f: FactureGlobale) {
    const lignes = await obtenirDetailFacture(f.beneficiaireType, f.id);
    setDetail({ facture: f, lignes: lignes ?? [] });
  }

  async function decocher(f: FactureGlobale, ligneId: string) {
    const r = await decocherLigneContestee(f.beneficiaireType, f.id, ligneId, cible);
    if (r.ok) {
      succes(r.message ?? 'Ligne retirée.');
      setDetail(null);
    } else {
      echec(r.error);
    }
  }

  async function valider(f: FactureGlobale) {
    const r = await validerPourPaiementGlobal(f.beneficiaireType, f.id, cible);
    if (r.ok) succes(r.message ?? 'Validée.');
    else echec(r.error);
  }

  function basculerSelection(f: FactureGlobale) {
    setSelection((s) => {
      const copie = new Set(s);
      if (copie.has(f.id)) copie.delete(f.id);
      else copie.add(f.id);
      return copie;
    });
  }

  const facturesSelectionnees = enPaiement.filter((f) => selection.has(f.id));
  const premiereSelection = facturesSelectionnees[0] ?? null;
  const selectionValide =
    facturesSelectionnees.length >= 2 &&
    facturesSelectionnees.every(
      (f) => f.beneficiaireType === premiereSelection?.beneficiaireType && f.beneficiaireNom === premiereSelection?.beneficiaireNom,
    );

  async function grouper() {
    if (!premiereSelection || !selectionValide) return;
    const r = await associerFacturesPourPaiement(
      premiereSelection.beneficiaireType,
      [...selection],
      cible,
    );
    if (r.ok) {
      succes(r.message ?? 'Regroupées.');
      setSelection(new Set());
    } else {
      echec(r.error);
    }
  }

  async function marquerGroupePaye(id: string) {
    const r = await marquerPaiementGroupePaye(id, cible);
    if (r.ok) succes(r.message ?? 'Payé.');
    else echec(r.error);
  }

  const colonnesBase: ColonneTable<FactureGlobale>[] = [
    {
      cle: 'beneficiaireType',
      entete: 'Type',
      rendu: (f) => <span className="text-xs">{f.beneficiaireType === 'ETABLISSEMENT' ? 'Établissement' : 'Pharmacie'}</span>,
    },
    { cle: 'beneficiaireNom', entete: 'Bénéficiaire', triable: true },
    {
      cle: 'periode',
      entete: 'Période',
      triable: true,
      valeur: (f) => f.periode,
      rendu: (f) => moisFr(f.periode),
    },
    {
      cle: 'montantTotal',
      entete: 'Montant',
      aligneDroite: true,
      valeur: (f) => Number(f.montantTotal),
      rendu: (f) => montant(f.montantTotal),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (f) => <StatutBadge statut={f.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />,
    },
  ];

  function actionsPourStatut(f: FactureGlobale) {
    return (
      <div className="flex items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => ouvrirDetail(f)}>
          Détail
        </Button>
        {STATUTS_VERIFIES.includes(f.statut) && (
          <Button size="xs" onClick={() => valider(f)}>
            Valider pour paiement
          </Button>
        )}
      </div>
    );
  }

  const section = (titre: string, donnees: FactureGlobale[], vide: string) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titre} ({donnees.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          donnees={donnees}
          cleLigne={(f) => f.id}
          parPage={10}
          colonnes={colonnesBase}
          actionLigne={actionsPourStatut}
          vide={vide}
        />
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {message && (
        <p
          className={
            message.ok
              ? 'rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
              : 'rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive'
          }
        >
          {message.texte}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Selecteur
            libelle="Bénéficiaire"
            valeur={filtreBeneficiaire}
            onChange={setFiltreBeneficiaire}
            options={optBeneficiaires.map((v) => ({ valeur: v, libelle: v }))}
          />
          <Selecteur
            libelle="Société cliente"
            valeur={filtreSociete}
            onChange={setFiltreSociete}
            options={optSocietes.map((v) => ({ valeur: v, libelle: v }))}
          />
          <Selecteur
            libelle="Type d'acte"
            valeur={filtreTypeActe}
            onChange={setFiltreTypeActe}
            options={optTypesActe.map((v) => ({ valeur: v, libelle: v }))}
          />
          <Selecteur
            libelle="Adhérent / famille"
            valeur={filtreAdherent}
            onChange={setFiltreAdherent}
            options={optAdherents.map((v) => ({ valeur: v, libelle: v }))}
          />
          <Selecteur
            libelle="Période"
            valeur={filtrePeriode}
            onChange={setFiltrePeriode}
            options={optPeriodes.map((v) => ({ valeur: v, libelle: moisFr(`${v}-01`) }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consommation par période (selon les filtres actifs)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={donneesChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="periode" tickFormatter={(v) => moisFr(`${v}-01`)} fontSize={12} />
                <YAxis tickFormatter={(v) => Number(v).toLocaleString('fr-FR')} fontSize={12} />
                <Tooltip formatter={(v) => montant(String(v))} labelFormatter={(v) => moisFr(`${v}-01`)} />
                <Legend />
                <Bar dataKey="montantTotal" name="Montant total" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {section(`Factures du mois (${periodePlusRecente ? moisFr(`${periodePlusRecente}-01`) : '—'})`, duMois, 'Aucune facture ce mois-ci.')}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">En paiement ({enPaiement.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectionValide && (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={grouper}>
                Regrouper {facturesSelectionnees.length} factures en un paiement
              </Button>
              <span className="text-xs text-muted-foreground">
                {premiereSelection?.beneficiaireNom} — {montant(
                  facturesSelectionnees.reduce((acc, f) => acc + Number(f.montantTotal), 0).toFixed(2),
                )}
              </span>
            </div>
          )}
          <DataTable
            donnees={enPaiement}
            cleLigne={(f) => f.id}
            parPage={10}
            colonnes={[
              {
                cle: 'selection',
                entete: '',
                rendu: (f) => (
                  <input
                    type="checkbox"
                    checked={selection.has(f.id)}
                    onChange={() => basculerSelection(f)}
                    disabled={
                      !!premiereSelection &&
                      !selection.has(f.id) &&
                      (f.beneficiaireType !== premiereSelection.beneficiaireType ||
                        f.beneficiaireNom !== premiereSelection.beneficiaireNom)
                    }
                    aria-label={`Sélectionner ${f.beneficiaireNom}`}
                  />
                ),
              },
              ...colonnesBase,
            ]}
            actionLigne={(f) => (
              <Button size="xs" variant="ghost" onClick={() => ouvrirDetail(f)}>
                Détail
              </Button>
            )}
            vide="Aucune facture en paiement."
          />
        </CardContent>
      </Card>

      {section('Partiellement réglées', partiellementReglees, 'Aucune facture partiellement réglée.')}
      {section('Impayées', impayees, 'Aucune facture impayée.')}
      {section('Réglées', reglees, 'Aucune facture réglée.')}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paiements groupés</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={paiementsGroupesInitiaux}
            cleLigne={(g) => g.id}
            parPage={10}
            colonnes={[
              {
                cle: 'beneficiaireType',
                entete: 'Type',
                rendu: (g) => <span className="text-xs">{g.beneficiaireType === 'ETABLISSEMENT' ? 'Établissement' : 'Pharmacie'}</span>,
              },
              { cle: 'beneficiaireNom', entete: 'Bénéficiaire', triable: true },
              { cle: 'nbFactures', entete: 'Factures', aligneDroite: true },
              {
                cle: 'montantTotal',
                entete: 'Montant',
                aligneDroite: true,
                valeur: (g) => Number(g.montantTotal),
                rendu: (g) => montant(g.montantTotal),
              },
              {
                cle: 'statut',
                entete: 'Statut',
                rendu: (g) => (
                  <StatutBadge
                    statut={g.statut}
                    map={{ PROGRAMME: 'attention', PAYE: 'succes' }}
                    libelles={{ PROGRAMME: 'Programmé', PAYE: 'Payé' }}
                  />
                ),
              },
            ]}
            actionLigne={(g) =>
              g.statut === 'PROGRAMME' ? (
                <Button size="xs" onClick={() => marquerGroupePaye(g.id)}>
                  Marquer payé
                </Button>
              ) : null
            }
            vide="Aucun paiement groupé pour l’instant."
          />
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Détail — {detail.facture.beneficiaireNom} ({moisFr(detail.facture.periode)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1.5">Ligne</th>
                  <th className="py-1.5 text-right">Montant</th>
                  <th className="py-1.5">État</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {detail.lignes.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-1.5">{l.libelle}</td>
                    <td className="py-1.5 text-right">{montant(l.montant)}</td>
                    <td className="py-1.5">
                      {l.enLitige ? <span className="text-xs text-destructive">En litige</span> : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      {l.enLitige && (
                        <Button size="xs" variant="destructive" onClick={() => decocher(detail.facture, l.id)}>
                          Décocher
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.lignes.length === 0 && <p className="text-sm text-muted-foreground">Aucune ligne.</p>}
            <Button size="xs" variant="ghost" className="mt-2" onClick={() => setDetail(null)}>
              Fermer
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
