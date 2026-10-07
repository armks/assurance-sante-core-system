'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  confirmerPaiementDispensation,
  obtenirDispensation,
  obtenirStock,
  preparerDispensation,
  rechercherParCarte,
  substituerMedicament,
} from '@/app/dashboard-pharmacie/dispensation-actions';
import type {
  DispensationDetail,
  LigneStock,
  PrescriptionActive,
  RecherchePrescriptionsResultat,
} from '@/app/dashboard-pharmacie/dispensation-types';
import {
  ChampTexte,
  ChampZone,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LIBELLE_STATUT_RECLAMATION } from '@/lib/reclamations';

const STATUTS_DISPENSATION_MODIFIABLE = ['EN_PREPARATION', 'EN_ATTENTE_VALIDATION_PATIENT'];
const INTERVALLE_SONDAGE_MS = 4000;

const montantFr = (v: string | number) =>
  `${Number(v).toLocaleString('fr-FR')} F`;

export function DispensationFlowEcran({
  role,
  cible,
  stockInitial,
}: {
  role: 'CAISSIERE' | 'PHARMACIEN';
  cible: string;
  stockInitial: LigneStock[];
}) {
  const peutSubstituer = role === 'PHARMACIEN';
  const [pending, startTransition] = useTransition();

  const [numeroCarte, setNumeroCarte] = useState('');
  const [rechercheErreur, setRechercheErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<RecherchePrescriptionsResultat | null>(null);

  const [stock, setStock] = useState<LigneStock[]>(stockInitial);
  const stockParDenomination = useMemo(
    () => new Map(stock.map((s) => [s.denominationMedicament, s])),
    [stock],
  );

  const [ordonnanceId, setOrdonnanceId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [prixLocal, setPrixLocal] = useState<Record<string, string>>({});
  const [preparationErreur, setPreparationErreur] = useState<string | null>(null);

  const [dispensation, setDispensation] = useState<DispensationDetail | null>(null);
  const [paiementErreur, setPaiementErreur] = useState<string | null>(null);

  const ordonnanceSelectionnee: PrescriptionActive | null =
    resultat?.ordonnances.find((o) => o.id === ordonnanceId) ?? null;

  function reinitialiser() {
    setResultat(null);
    setOrdonnanceId(null);
    setSelections({});
    setPrixLocal({});
    setPreparationErreur(null);
    setDispensation(null);
    setPaiementErreur(null);
    setNumeroCarte('');
  }

  function rechercher() {
    setRechercheErreur(null);
    setResultat(null);
    startTransition(async () => {
      const res = await rechercherParCarte(numeroCarte.trim());
      if (!res.ok) {
        setRechercheErreur(res.error);
        return;
      }
      setResultat(res.resultat);
    });
  }

  function rafraichirStock() {
    startTransition(async () => {
      setStock(await obtenirStock());
    });
  }

  function selectionnerOrdonnance(id: string) {
    setOrdonnanceId(id);
    setSelections({});
    setPrixLocal({});
    setPreparationErreur(null);
  }

  const totalLocal = ordonnanceSelectionnee
    ? ordonnanceSelectionnee.lignes.reduce((acc, ligne) => {
        if (!selections[ligne.id]) return acc;
        const s = stockParDenomination.get(ligne.denominationMedicament);
        const prix = Number(prixLocal[ligne.id] ?? s?.prixPharmacie ?? 0);
        return acc + prix * ligne.quantitePrescrite;
      }, 0)
    : 0;

  const auMoinsUneLigneChoisie = Object.values(selections).some(Boolean);

  function envoyerCode() {
    if (!ordonnanceSelectionnee) return;
    setPreparationErreur(null);
    const lignes = ordonnanceSelectionnee.lignes
      .filter((l) => selections[l.id])
      .map((l) => ({ ligneOrdonnanceId: l.id }));
    startTransition(async () => {
      const res = await preparerDispensation(ordonnanceSelectionnee.id, lignes, cible);
      if (!res.ok) {
        setPreparationErreur(res.error);
        return;
      }
      const detail = await obtenirDispensation(res.dispensationId!);
      setDispensation(detail);
    });
  }

  const dispensationIdRef = useRef<string | null>(null);
  dispensationIdRef.current = dispensation?.id ?? null;

  async function rafraichirDispensation() {
    if (!dispensationIdRef.current) return;
    const detail = await obtenirDispensation(dispensationIdRef.current);
    if (detail) setDispensation(detail);
  }

  useEffect(() => {
    if (!dispensation) return;
    if (!STATUTS_DISPENSATION_MODIFIABLE.includes(dispensation.statut)) return;
    const id = setInterval(() => {
      void rafraichirDispensation();
    }, INTERVALLE_SONDAGE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispensation?.id, dispensation?.statut]);

  function confirmerPaiement() {
    if (!dispensation) return;
    setPaiementErreur(null);
    startTransition(async () => {
      const res = await confirmerPaiementDispensation(dispensation.id, cible);
      if (!res.ok) {
        setPaiementErreur(res.error);
        return;
      }
      await rafraichirDispensation();
    });
  }

  return (
    <div className="space-y-6">
      {/* --- Recherche par numéro de carte --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rechercher un patient</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-sm font-medium">Numéro de carte</label>
            <Input
              value={numeroCarte}
              onChange={(e) => setNumeroCarte(e.target.value)}
              placeholder="Ex. CM-0000000001"
              onKeyDown={(e) => {
                if (e.key === 'Enter') rechercher();
              }}
            />
          </div>
          <Button onClick={rechercher} disabled={pending || !numeroCarte.trim()}>
            Rechercher
          </Button>
          {resultat && (
            <Button variant="ghost" onClick={reinitialiser} disabled={pending}>
              Nouvelle recherche
            </Button>
          )}
        </CardContent>
      </Card>

      {rechercheErreur && <p className="text-sm text-destructive">{rechercheErreur}</p>}

      {/* --- Résultat : patient + liste des prescriptions actives --- */}
      {resultat && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {resultat.patient.prenom} {resultat.patient.nom}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {resultat.patient.qualite === 'TITULAIRE' ? 'Titulaire' : 'Bénéficiaire'} —{' '}
                {resultat.patient.numeroCarte}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {resultat.ordonnances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune prescription active pour ce patient.</p>
            ) : (
              resultat.ordonnances.map((o) => (
                <div
                  key={o.id}
                  className={`flex items-center justify-between rounded-md border p-3 ${
                    o.id === ordonnanceId ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <div className="text-sm">
                    <p className="font-medium">{o.numeroTraitement}</p>
                    <p className="text-muted-foreground">
                      {o.lignes.length} médicament(s) — prescrite le{' '}
                      {new Date(o.datePrescription).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={o.id === ordonnanceId ? 'default' : 'outline'}
                    onClick={() => selectionnerOrdonnance(o.id)}
                  >
                    Sélectionner
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Lignes de la prescription sélectionnée --- */}
      {ordonnanceSelectionnee && !dispensation && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Lignes de {ordonnanceSelectionnee.numeroTraitement}
            </CardTitle>
            <Button size="xs" variant="ghost" onClick={rafraichirStock} disabled={pending}>
              Rafraîchir le stock
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2"></th>
                    <th className="py-2 pr-2">Médicament</th>
                    <th className="py-2 pr-2">Posologie</th>
                    <th className="py-2 pr-2">Qté</th>
                    <th className="py-2 pr-2">Statut</th>
                    <th className="py-2 pr-2">Prix unitaire</th>
                  </tr>
                </thead>
                <tbody>
                  {ordonnanceSelectionnee.lignes.map((ligne) => {
                    const s = stockParDenomination.get(ligne.denominationMedicament);
                    const enStock = !!s && s.disponible && s.prixPharmacie !== null;
                    const selectionnable = ligne.statut === 'DISPONIBLE' && enStock;
                    return (
                      <tr
                        key={ligne.id}
                        className={`border-b last:border-0 ${!selectionnable ? 'opacity-50' : ''}`}
                      >
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            className="size-4"
                            disabled={!selectionnable}
                            checked={!!selections[ligne.id]}
                            onChange={(e) =>
                              setSelections((prev) => ({ ...prev, [ligne.id]: e.target.checked }))
                            }
                          />
                        </td>
                        <td className="py-2 pr-2 font-medium">
                          {ligne.denominationMedicament}
                          {ligne.dosage ? ` (${ligne.dosage})` : ''}
                        </td>
                        <td className="py-2 pr-2 text-muted-foreground">{ligne.posologie}</td>
                        <td className="py-2 pr-2">{ligne.quantitePrescrite}</td>
                        <td className="py-2 pr-2">
                          {ligne.statut === 'SERVIE' ? (
                            <StatutBadge statut="SERVIE" ton="neutre" libelle="Déjà servie" />
                          ) : enStock ? (
                            <StatutBadge statut="DISPONIBLE" ton="succes" libelle="Disponible" />
                          ) : (
                            <StatutBadge
                              statut="INDISPONIBLE"
                              ton="attention"
                              libelle="Prix non défini par le pharmacien"
                            />
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          {selectionnable ? (
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 w-28"
                              value={prixLocal[ligne.id] ?? s?.prixPharmacie ?? ''}
                              onChange={(e) =>
                                setPrixLocal((prev) => ({ ...prev, [ligne.id]: e.target.value }))
                              }
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Le prix affiché ici sert au calcul indicatif communiqué au patient ; le montant
              définitif reste celui du tarif de la pharmacie au moment de la préparation.
            </p>

            <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
              <span className="text-sm font-medium">Total à communiquer au patient</span>
              <span className="text-lg font-semibold">{montantFr(totalLocal)}</span>
            </div>

            {preparationErreur && <p className="text-sm text-destructive">{preparationErreur}</p>}

            <div className="flex justify-end">
              <Button onClick={envoyerCode} disabled={pending || !auMoinsUneLigneChoisie}>
                Envoyer le code de confirmation au patient
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- Dispensation en cours : attente / paiement --- */}
      {dispensation && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Dispensation</CardTitle>
            <StatutBadge
              statut={dispensation.statut}
              libelles={{
                EN_PREPARATION: 'En préparation',
                EN_ATTENTE_VALIDATION_PATIENT: 'En attente de validation par le patient',
                VALIDEE: 'Validée par le patient',
                PAYEE: 'Payée',
                ANNULEE: 'Annulée',
              }}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              {dispensation.lignes.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <p className="font-medium">
                      {l.medicamentSubstitue ?? l.denominationMedicament}
                      {l.medicamentSubstitue && (
                        <span className="ml-2 text-xs font-normal text-amber-600">
                          (substitué depuis {l.denominationMedicament}
                          {l.motifSubstitution ? ` — ${l.motifSubstitution}` : ''})
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      {l.quantite} × {montantFr(l.prixUnitaire)} = {montantFr(l.montantLigne)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Assurance {montantFr(l.montantAssurance)} · Patient {montantFr(l.montantPatient)}
                    </p>
                  </div>
                  <BoutonSubstitution
                    ligne={l}
                    peutSubstituer={peutSubstituer}
                    dispensationStatut={dispensation.statut}
                    cible={cible}
                    onSucces={rafraichirDispensation}
                  />
                </li>
              ))}
            </ul>

            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Montant total (officiel)</span>
                <span className="text-lg font-semibold">{montantFr(dispensation.montantTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Part assurance</span>
                <span>{montantFr(dispensation.montantAssurance)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
                <span>Part patient à percevoir</span>
                <span className="text-base">{montantFr(dispensation.montantPatient)}</span>
              </div>
            </div>

            {paiementErreur && <p className="text-sm text-destructive">{paiementErreur}</p>}

            {dispensation.statut === 'PAYEE' ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-emerald-600">
                  Paiement confirmé ({montantFr(dispensation.montantPatient)} perçus) — la ou les
                  ligne(s) sont verrouillées pour votre pharmacie.
                </p>
                {dispensation.reclamation && (
                  <p className="text-sm text-muted-foreground">
                    Réclamation soumise à l’adjudication (
                    {montantFr(dispensation.montantAssurance)} — statut{' '}
                    {LIBELLE_STATUT_RECLAMATION[dispensation.reclamation.statut] ??
                      dispensation.reclamation.statut}).
                  </p>
                )}
                <Button onClick={reinitialiser}>Nouvelle dispensation</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="ghost" onClick={() => void rafraichirDispensation()} disabled={pending}>
                  Rafraîchir le statut
                </Button>
                <Button
                  onClick={confirmerPaiement}
                  disabled={pending || dispensation.statut !== 'VALIDEE'}
                  title={
                    dispensation.statut !== 'VALIDEE'
                      ? "En attente de validation du code par le patient"
                      : undefined
                  }
                >
                  Confirmer le paiement ({montantFr(dispensation.montantPatient)})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BoutonSubstitution({
  ligne,
  peutSubstituer,
  dispensationStatut,
  cible,
  onSucces,
}: {
  ligne: DispensationDetail['lignes'][number];
  peutSubstituer: boolean;
  dispensationStatut: string;
  cible: string;
  onSucces: () => void;
}) {
  const modifiable = STATUTS_DISPENSATION_MODIFIABLE.includes(dispensationStatut);

  if (!peutSubstituer || !modifiable) {
    return (
      <Button
        size="xs"
        variant="outline"
        disabled
        title={
          !peutSubstituer
            ? 'Réservé au pharmacien'
            : 'Substitution impossible après validation du paiement'
        }
      >
        Demander une substitution
      </Button>
    );
  }

  return (
    <FormulaireModal
      titre="Substituer un médicament"
      mode="center"
      description={`Remplace « ${ligne.denominationMedicament} » sur cette dispensation. Motif obligatoire (audité).`}
      declencheurLabel="Demander une substitution"
      libelleSoumettre="Substituer"
      onSoumettre={async (fd) =>
        substituerMedicament(
          ligne.id,
          {
            nouveauMedicament: String(fd.get('nouveauMedicament') ?? ''),
            motif: String(fd.get('motif') ?? ''),
          },
          cible,
        )
      }
      onSucces={onSucces}
    >
      <ChampTexte name="nouveauMedicament" label="Nouveau médicament" required maxLength={200} />
      <ChampZone name="motif" label="Motif de la substitution" required maxLength={500} />
    </FormulaireModal>
  );
}
