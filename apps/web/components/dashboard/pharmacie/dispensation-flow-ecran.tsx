'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  annulerDispensation,
  renouvelerCodeDispensation,
  confirmerPaiementDispensation,
  validerCodeParPharmacie,
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
  ChampZone,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { FichePatient } from '../centre-medical/fiche-patient';
import { ChampMedicamentBase } from './champ-medicament-base';
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
  historique,
}: {
  role: 'CAISSIERE' | 'PHARMACIEN';
  cible: string;
  stockInitial: LigneStock[];
  /** Historique du patient : affiché uniquement une fois la recherche effectuée dans CET écran. */
  historique?: React.ReactNode;
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
  const [alertesPreparation, setAlertesPreparation] = useState<
    { medicament: string; prixUnitaire: string; prixReference: string; majorationPourcent: string }[]
  >([]);

  const [ordonnanceId, setOrdonnanceId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [prixLocal, setPrixLocal] = useState<Record<string, string>>({});
  const [preparationErreur, setPreparationErreur] = useState<string | null>(null);

  const [dispensation, setDispensation] = useState<DispensationDetail | null>(null);
  const [paiementErreur, setPaiementErreur] = useState<string | null>(null);
  const [nouveauCodeInfo, setNouveauCodeInfo] = useState<string | null>(null);

  const ordonnanceSelectionnee: PrescriptionActive | null =
    resultat?.ordonnances.find((o) => o.id === ordonnanceId) ?? null;

  const router = useRouter();

  // Un `?carte=` resté dans l'adresse (rechargement, lien) ne doit rien afficher : pas de recherche, pas d'historique.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('carte')) router.replace(cible, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reinitialiser() {
    router.replace(cible, { scroll: false });
    setResultat(null);
    setOrdonnanceId(null);
    setSelections({});
    setPrixLocal({});
    setAlertesPreparation([]);
    setPreparationErreur(null);
    setDispensation(null);
    setPaiementErreur(null);
    setNumeroCarte('');
    setCanal('');
    setNonCouvert(false);
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
      // l'historique de la page se limite à ce patient
      router.replace(`${cible}?carte=${encodeURIComponent(res.resultat.patient.numeroCarte)}`, { scroll: false });
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
    setPaiementErreur(null);
    // Facture déjà ouverte : on affiche ses montants et le champ du code, sans refaire la facturation.
    const enCours = resultat?.ordonnances.find((o) => o.id === id)?.dispensationEnCours;
    if (enCours) {
      startTransition(async () => {
        const detail = await obtenirDispensation(enCours.id);
        if (detail) setDispensation(detail);
      });
    } else {
      setDispensation(null);
    }
  }

  const totalLocal = ordonnanceSelectionnee
    ? ordonnanceSelectionnee.lignes.reduce((acc, ligne) => {
        if (!selections[ligne.id]) return acc;
        const prix = Number(prixLocal[ligne.id] ?? 0);
        return acc + prix * ligne.quantitePrescrite;
      }, 0)
    : 0;

  /** Majoration (%) du prix saisi par rapport au prix national unique ; null si inconnu. */
  const majorationDe = (ligne: { id: string; prixReference?: string | null }): number | null => {
    const ref = Number(ligne.prixReference ?? 0);
    const prix = Number(prixLocal[ligne.id] ?? 0);
    return ref > 0 && prix > 0 ? Math.round((prix / ref - 1) * 10000) / 100 : null;
  };
  const seuilMajoration = resultat?.seuilMajorationPourcent ?? 20;
  const prixManquant = (ordonnanceSelectionnee?.lignes ?? []).some(
    (l) => selections[l.id] && !(Number(prixLocal[l.id]) > 0),
  );

  const auMoinsUneLigneChoisie = Object.values(selections).some(Boolean);

  const contacts = resultat?.patient.contacts ?? [];
  const [canal, setCanal] = useState<'EMAIL' | 'SMS' | ''>('');
  const [nonCouvert, setNonCouvert] = useState(false);

  function envoyerCode() {
    if (!ordonnanceSelectionnee) return;
    setPreparationErreur(null);
    const lignes = ordonnanceSelectionnee.lignes
      .filter((l) => selections[l.id])
      .map((l) => ({ ligneOrdonnanceId: l.id, prixUnitaire: Number(prixLocal[l.id]) }));
    startTransition(async () => {
      const res = await preparerDispensation(ordonnanceSelectionnee.id, lignes, cible, canal || undefined);
      if (!res.ok) {
        setPreparationErreur(res.error);
        return;
      }
      setAlertesPreparation(res.alertes ?? []);
      setNonCouvert(res.pharmacieCouverte === false);
      const detail = await obtenirDispensation(res.dispensationId!);
      setDispensation(detail);
    });
  }

  const [codeSaisi, setCodeSaisi] = useState('');

  function validerCodePatient() {
    if (!dispensation) return;
    setPaiementErreur(null);
    startTransition(async () => {
      const res = await validerCodeParPharmacie(dispensation.id, codeSaisi.trim(), cible);
      if (!res.ok) {
        setPaiementErreur(res.error);
        return;
      }
      setCodeSaisi('');
      await rafraichirDispensation();
    });
  }

  function nouveauCode() {
    if (!dispensation) return;
    setPaiementErreur(null);
    setNouveauCodeInfo(null);
    startTransition(async () => {
      const res = await renouvelerCodeDispensation(dispensation.id, cible);
      if (!res.ok) {
        setPaiementErreur(res.error);
        return;
      }
      setNouveauCodeInfo(`Nouveau code : ${res.code} — valable jusqu’à ${new Date(res.expireLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Communiquez-le au patient ; l’ancien n’est plus valable.`);
    });
  }

  function supprimerFacture() {
    if (!dispensation) return;
    if (!window.confirm('Supprimer cette facture non réglée ? Le code envoyé au patient ne sera plus valable.')) return;
    setPaiementErreur(null);
    startTransition(async () => {
      const res = await annulerDispensation(dispensation.id, cible);
      if (!res.ok) {
        setPaiementErreur(res.error);
        return;
      }
      reinitialiser();
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
    <div className="space-y-3">
      {/* --- Recherche par numéro de carte --- */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Rechercher un patient</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="w-full max-w-60">
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
          <CardHeader className="pb-0">
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5 sm:flex-row sm:items-stretch sm:gap-4" data-testid="fiche-patient-pharmacie">
              <FichePatient
                compact
                patient={{
                  nom: resultat.patient.nom,
                  prenom: resultat.patient.prenom,
                  dateNaissance: resultat.patient.dateNaissance,
                  sexe: resultat.patient.sexe,
                  numeroCarte: resultat.patient.numeroCarte,
                  societe: resultat.patient.societe,
                  photoUrl: resultat.patient.photoUrl,
                  lien: resultat.patient.lien,
                  formule: resultat.patient.produit,
                }}
              />
              <dl className="grid flex-1 content-between gap-y-1.5 text-sm">
                <div>
                  <dt className="text-sm text-muted-foreground">Statut de la carte</dt>
                  <dd className="font-medium">{resultat.patient.statut}</dd>
                </div>
                <div className="grid grid-cols-2 gap-x-4">
                  <div><dt className="text-sm text-muted-foreground">Police</dt><dd>{resultat.patient.police ?? '—'}</dd></div>
                  <div><dt className="text-sm text-muted-foreground">Souscripteur</dt><dd>{resultat.patient.societe ?? '—'}</dd></div>
                </div>
                {contacts.length > 0 ? (
                  <fieldset className="space-y-0.5 border-t pt-1.5" disabled={!!dispensation}>
                    <legend className="text-sm font-medium">Canal d’envoi du code</legend>
                    {contacts.map((c) => (
                      <label key={c.canal} className={`flex items-center gap-1.5 text-sm ${c.actif ? '' : 'opacity-60'}`}>
                        <input type="radio" name="canal" value={c.canal} checked={canal === c.canal} disabled={!c.actif} onChange={() => setCanal(c.canal)} data-testid={`canal-${c.canal}`} />
                        <span>{c.canal === 'EMAIL' ? 'E-mail' : 'Téléphone (SMS)'} — <span className="font-mono">{c.masque}</span></span>
                        {c.avertissement && <span className="text-[11px] text-muted-foreground">({c.avertissement})</span>}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="border-t pt-1.5 text-sm text-amber-700">Aucun contact enregistré : le code restera visible dans l’application du patient.</p>
                )}
              </dl>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {resultat.ordonnances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune prescription à servir ni en attente de validation pour ce patient.</p>
            ) : (
              resultat.ordonnances.map((o) => (
                <div
                  key={o.id}
                  className={`flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 transition-colors ${
                    o.id === ordonnanceId ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-semibold">{o.numeroTraitement}</span>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {o.lignes.length} médicament(s) — prescrite le{' '}
                      {new Date(o.datePrescription).toLocaleDateString('fr-FR')}
                    </span>
                    {o.dispensationEnCours && (
                      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {o.dispensationEnCours.statut === 'VALIDEE' ? 'Code validé — paiement à confirmer' : 'En attente de validation'}
                      </span>
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant={o.id === ordonnanceId ? 'default' : 'outline'}
                    onClick={() => selectionnerOrdonnance(o.id)}
                  >
                    {o.dispensationEnCours ? 'Voir la facture' : 'Sélectionner'}
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
                    <th className="py-2 pr-2">Prix national</th>
                    <th className="py-2 pr-2">Prix pratiqué (F)</th>
                  </tr>
                </thead>
                <tbody>
                  {ordonnanceSelectionnee.lignes.map((ligne) => {
                    const s = stockParDenomination.get(ligne.denominationMedicament);
                    const indisponible = !!s && !s.disponible;
                    const selectionnable = ligne.statut === 'DISPONIBLE' && !indisponible;
                    const majoration = majorationDe(ligne);
                    const alerte = majoration !== null && majoration > seuilMajoration;
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
                          ) : !indisponible ? (
                            <StatutBadge statut="DISPONIBLE" ton="succes" libelle="Disponible" />
                          ) : (
                            <StatutBadge
                              statut="INDISPONIBLE"
                              ton="attention"
                              libelle="Indisponible dans la pharmacie"
                            />
                          )}
                        </td>
                        <td className="py-2 pr-2 text-muted-foreground">
                          {ligne.prixReference ? montantFr(ligne.prixReference) : '—'}
                        </td>
                        <td className="py-2 pr-2">
                          {selectionnable ? (
                            <div className="space-y-1">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                className="h-8 w-28"
                                aria-label={`Prix pratiqué — ${ligne.denominationMedicament}`}
                                value={prixLocal[ligne.id] ?? ''}
                                onChange={(e) =>
                                  setPrixLocal((prev) => ({ ...prev, [ligne.id]: e.target.value }))
                                }
                              />
                              {majoration !== null && (
                                <p
                                  role={alerte ? 'alert' : undefined}
                                  className={`text-xs ${alerte ? 'font-medium text-amber-600' : 'text-muted-foreground'}`}
                                >
                                  {alerte
                                    ? `Majoration de ${majoration} % : au-delà de ${seuilMajoration} % autorisés`
                                    : `Majoration ${majoration} %`}
                                </p>
                              )}
                            </div>
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
              Saisissez le prix pratiqué par votre pharmacie pour chaque médicament. Le prix national
              unique sert de référence : une majoration au-delà du seuil de la plateforme déclenche une
              alerte (la vente reste possible).
            </p>

            <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
              <span className="text-sm font-medium">Total à communiquer au patient</span>
              <span className="text-lg font-semibold">{montantFr(totalLocal)}</span>
            </div>

            {preparationErreur && <p className="text-sm text-destructive">{preparationErreur}</p>}
            {contacts.length > 0 && !canal && (
              <p className="text-sm text-muted-foreground">Choisissez d’abord le canal d’envoi du code (fiche du patient ci-dessus).</p>
            )}

            <div className="flex justify-end">
              <Button onClick={envoyerCode} disabled={pending || !auMoinsUneLigneChoisie || prixManquant || (contacts.length > 0 && !canal)}>
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
            {alertesPreparation.length > 0 && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                Majoration anormale signalée à l’assureur :{' '}
                {alertesPreparation
                  .map((a) => `${a.medicament} (+${a.majorationPourcent} % : ${montantFr(a.prixUnitaire)} pour un prix national de ${montantFr(a.prixReference)})`)
                  .join(' ; ')}
              </div>
            )}
            {nonCouvert && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                La formule du patient ne comporte aucune garantie « Pharmacie » : aucune part assurance n’est applicable (taux de couverture et ticket modérateur à définir sur le produit).
              </div>
            )}
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
              <div className="space-y-1 rounded-md border border-primary/40 bg-primary/5 p-3" data-testid="validation-code-patient">
                {dispensation.statut === 'EN_ATTENTE_VALIDATION_PATIENT' && (
                  <label htmlFor="code-patient" className="block text-sm font-medium">Code de validation communiqué par le patient</label>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {dispensation.statut === 'EN_ATTENTE_VALIDATION_PATIENT' && (
                    <>
                      <Input
                        id="code-patient"
                        value={codeSaisi}
                        onChange={(e) => setCodeSaisi(e.target.value.toUpperCase())}
                        maxLength={8}
                        autoComplete="off"
                        placeholder="Ex. K7M2QX"
                        className="h-9 w-40 font-mono tracking-widest"
                        onKeyDown={(e) => { if (e.key === 'Enter' && codeSaisi.trim().length >= 6) validerCodePatient(); }}
                      />
                      <Button onClick={validerCodePatient} disabled={pending || codeSaisi.trim().length < 6}>Valider le code</Button>
                    </>
                  )}
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={supprimerFacture} disabled={pending}>
                      Supprimer la facture
                    </Button>
                    {dispensation.statut === 'EN_ATTENTE_VALIDATION_PATIENT' && (
                      <Button variant="ghost" onClick={nouveauCode} disabled={pending} title="Le code est valable 2 h : générez-en un nouveau s'il a expiré ou est perdu">
                        Nouveau code
                      </Button>
                    )}
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
                </div>
                {dispensation.statut === 'EN_ATTENTE_VALIDATION_PATIENT' && (
                  <p className="text-xs text-muted-foreground">Code reçu par le patient : saisissez-le pour débloquer le paiement.</p>
                )}
                {nouveauCodeInfo && <p className="text-sm font-medium" role="status">{nouveauCodeInfo}</p>}
                {paiementErreur && <p className="text-sm text-destructive">{paiementErreur}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {resultat && historique}
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
      onSoumettre={async (fd) => {
        const nouveauMedicamentId = String(fd.get('nouveauMedicamentId') ?? '');
        if (!nouveauMedicamentId) return { ok: false, error: 'Choisissez le nouveau médicament dans la liste de la base.' };
        return substituerMedicament(ligne.id, { nouveauMedicamentId, motif: String(fd.get('motif') ?? '') }, cible);
      }}
      onSucces={onSucces}
    >
      <ChampMedicamentBase name="nouveauMedicamentId" label="Nouveau médicament" />
      <ChampZone name="motif" label="Motif de la substitution" required maxLength={500} />
    </FormulaireModal>
  );
}
