'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { CheckCircle2, Search, XCircle } from 'lucide-react';

import {
  emettreCodeAccueil,
  fichePourAccueil,
  validerCodeConsultation,
  type CodeEmisAccueil,
  type FicheCarte,
  type MentionCarte,
  type TypeActeAccueil,
} from '@/app/dashboard-centre-medical/accueil/actions';
import { Alerte, ChampSelect, ChampTexte } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Resultat =
  | { ok: true; dossierId: string; numeroTraitement: string }
  | { ok: false; error: string; blocages: string[] };

type ResultatRecherche =
  | { ok: true; fiche: FicheCarte; types: TypeActeAccueil[] }
  | { ok: false; error: string };

const TON_MENTION: Record<MentionCarte, string> = {
  ACTIVE: 'bg-emerald-600 text-white',
  SUSPENDUE: 'bg-amber-500 text-white',
  'RADIÉE': 'bg-red-600 text-white',
  'SORTIE EN COURS': 'bg-amber-500 text-white',
  'POLICE NON ACTIVE': 'bg-red-600 text-white',
  'PÉRIMÈTRE NON ACTIF': 'bg-red-600 text-white',
};

const LIBELLE_CANAL = { EMAIL: 'E-mail', SMS: 'Téléphone (SMS)' } as const;

function formaterDate(iso: string): string {
  const [a, m, j] = iso.split('-');
  return `${j}/${m}/${a}`;
}

/** Carte virtuelle : identité, société, police et mention de validité. */
function CarteVirtuelle({ fiche }: { fiche: FicheCarte }) {
  return (
    <div className="flex flex-wrap gap-4 rounded-xl border bg-gradient-to-br from-slate-50 to-slate-100 p-4 dark:from-slate-900 dark:to-slate-800" data-testid="carte-virtuelle">
      {fiche.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée éphémère du stockage privé
        <img src={fiche.photoUrl} alt={`Photo de ${fiche.prenom} ${fiche.nom}`} width={96} height={112} className="h-28 w-24 rounded-md border object-cover" data-testid="fiche-photo" />
      ) : (
        <div className="flex h-28 w-24 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground" data-testid="fiche-photo-absente">
          Pas de photo
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-lg font-semibold" data-testid="fiche-nom">
          {fiche.prenom} {fiche.nom}
        </p>
        <p className="font-mono text-sm" data-testid="fiche-numero-carte">{fiche.numeroCarte}</p>
        <p className="text-sm text-muted-foreground">{fiche.type === 'ADHERENT_TITULAIRE' ? 'Adhérent titulaire' : 'Bénéficiaire'}</p>
      </div>
      <span
        className={`self-start rounded-md px-3 py-1 text-sm font-bold tracking-wide ${TON_MENTION[fiche.carte.mention]}`}
        data-testid="carte-mention"
        role="status"
      >
        {fiche.carte.mention}
      </span>
    </div>
  );
}

function RechercheCarte() {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<ResultatRecherche | null>(null);
  const [canal, setCanal] = useState<'EMAIL' | 'SMS' | ''>('');
  const [typeActe, setTypeActe] = useState('');
  const [envoi, setEnvoi] = useState<{ ok: true; code: CodeEmisAccueil } | { ok: false; error: string; blocages: string[] } | null>(null);

  function soumettre(formData: FormData) {
    const numeroCarte = String(formData.get('numeroCarte') ?? '').trim();
    demarrer(async () => {
      setResultat(null);
      setEnvoi(null);
      setTypeActe('');
      setCanal('');
      const r = await fichePourAccueil(numeroCarte);
      setResultat(r);
      if (r.ok) {
        // un seul contact enregistré : pré-sélectionné ; le patient peut toujours changer
        const actifs = r.fiche.contacts.liste.filter((c) => c.actif);
        if (actifs.length === 1) setCanal(actifs[0].canal);
      }
    });
  }

  function choisirTypeActe(code: string) {
    if (!resultat?.ok || !canal || !code) return;
    setTypeActe(code);
    demarrer(async () => {
      setEnvoi(await emettreCodeAccueil({ numeroCarte: resultat.fiche.numeroCarte, categorieActe: code, canal }));
    });
  }

  const fiche = resultat?.ok ? resultat.fiche : null;
  const contacts = fiche?.contacts.liste ?? [];
  const envoye = envoi?.ok === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="size-4" />
          Identification par numéro de carte
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Recherchez la carte du patient : la fiche s’affiche (consultation journalisée). Si la carte est ACTIVE, choisissez le canal puis le type d’acte :
          le code de confirmation est alors envoyé au patient.
        </p>
        <form action={soumettre} className="flex flex-wrap items-end gap-4">
          <ChampTexte name="numeroCarte" label="Numéro de carte" required autoComplete="off" placeholder="CM-0000000042" className="max-w-xs" />
          <Button type="submit" variant="outline" disabled={enCours}>
            {enCours && !fiche ? 'Recherche…' : 'Rechercher'}
          </Button>
        </form>

        {fiche && (
          <div className="space-y-4" data-testid="fiche-carte">
            <CarteVirtuelle fiche={fiche} />
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Société</dt><dd data-testid="fiche-societe">{fiche.societe}</dd></div>
              <div><dt className="text-muted-foreground">Date de naissance</dt><dd data-testid="fiche-naissance">{formaterDate(fiche.dateNaissance)}</dd></div>
              <div><dt className="text-muted-foreground">Police</dt><dd data-testid="fiche-police">{fiche.police?.numero ?? '—'}</dd></div>
              <div><dt className="text-muted-foreground">Souscripteur</dt><dd data-testid="fiche-souscripteur">{fiche.souscripteur.nom}</dd></div>
              <div><dt className="text-muted-foreground">Produit</dt><dd data-testid="fiche-produit">{fiche.produit ?? '—'}</dd></div>
            </dl>

            {!fiche.carte.active && (
              <Alerte ton="erreur" titre={`Carte ${fiche.carte.mention} — aucune consultation ne peut être ouverte`}>
                <ul className="list-disc pl-5 text-sm" data-testid="carte-motifs">
                  {fiche.carte.motifs.map((m) => (<li key={m}>{m}</li>))}
                </ul>
              </Alerte>
            )}

            {fiche.carte.active && contacts.length === 0 && (
              <Alerte ton="avertissement" titre="Aucun contact enregistré">
                <p className="text-sm" data-testid="aucun-contact">
                  Aucune adresse e-mail ni aucun numéro de téléphone n’est enregistré sur cette fiche : le code ne peut pas être envoyé et aucune consultation n’est ouverte. Le patient doit faire enregistrer un contact par son assureur.
                </p>
              </Alerte>
            )}

            {fiche.carte.active && contacts.length > 0 && (
              <div className="space-y-4">
                <fieldset className="space-y-2" disabled={enCours || envoye}>
                  <legend className="text-sm font-medium">
                    Canal d’envoi du code {fiche.contacts.source === 'TITULAIRE' && <span className="font-normal text-muted-foreground">(contacts du titulaire)</span>}
                  </legend>
                  {contacts.map((c) => (
                    <label key={c.canal} className={`flex items-center gap-2 text-sm ${c.actif ? '' : 'opacity-60'}`}>
                      <input type="radio" name="canal" value={c.canal} checked={canal === c.canal} disabled={!c.actif} onChange={() => setCanal(c.canal)} data-testid={`canal-${c.canal}`} />
                      <span>{LIBELLE_CANAL[c.canal]} — <span className="font-mono">{c.masque}</span></span>
                      {c.avertissement && <span className="text-xs text-muted-foreground">({c.avertissement})</span>}
                    </label>
                  ))}
                </fieldset>
                <ChampSelect
                  name="typeActe"
                  label="Type d’acte"
                  aide={canal ? 'Le choix du type d’acte envoie le code de confirmation au patient.' : 'Choisissez d’abord le canal d’envoi.'}
                  placeholder="Choisir un type d’acte…"
                  options={resultat?.ok ? resultat.types.map((t) => ({ valeur: t.code, libelle: t.libelle })) : []}
                  value={typeActe}
                  disabled={!canal || enCours || envoye}
                  onChange={(e) => choisirTypeActe(e.target.value)}
                  className="max-w-xs"
                />
              </div>
            )}

            {envoi?.ok && (
              <Alerte ton={envoi.code.statut === 'ENVOYE' ? 'succes' : 'avertissement'} titre={`Code pour « ${envoi.code.typeActe} » — ${LIBELLE_CANAL[envoi.code.canal]} ${envoi.code.destinataire}`}>
                <p className="text-sm" data-testid="envoi-resultat">{envoi.code.message}</p>
              </Alerte>
            )}
            {envoi && !envoi.ok && (
              <Alerte ton="erreur" titre="Code non envoyé">
                <p className="text-sm" data-testid="envoi-erreur">{envoi.error}</p>
                {envoi.blocages.length > 0 && (
                  <ul className="list-disc pl-5 text-sm">{envoi.blocages.map((b) => (<li key={b}>{b}</li>))}</ul>
                )}
              </Alerte>
            )}
          </div>
        )}

        {resultat && !resultat.ok && <p className="text-sm text-destructive">{resultat.error}</p>}
      </CardContent>
    </Card>
  );
}

export function AccueilEcran({
  etablissementId,
  peutValider,
  peutRechercherCarte,
}: {
  etablissementId: string;
  peutValider: boolean;
  peutRechercherCarte: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<Resultat | null>(null);

  if (!peutValider) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Votre rôle ne permet pas de valider un code de consultation. Seuls
          l’accueil, un médecin ou l’administratif du centre le peuvent.
        </CardContent>
      </Card>
    );
  }

  function soumettre(formData: FormData) {
    const code = String(formData.get('code') ?? '').trim();
    const motifConsultation = String(formData.get('motif') ?? '').trim();
    demarrer(async () => {
      setResultat(null);
      setResultat(
        await validerCodeConsultation({
          code,
          motifConsultation,
          etablissementId,
        }),
      );
    });
  }

  return (
    <div className="space-y-6">
      {peutRechercherCarte && <RechercheCarte />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Valider un code</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={soumettre} className="space-y-4">
            <ChampTexte
              name="code"
              label="Code de consultation"
              required
              autoComplete="off"
              maxLength={8}
              placeholder="6 à 8 caractères"
              className="max-w-xs"
            />
            <ChampTexte
              name="motif"
              label="Motif de la consultation"
              required
              maxLength={300}
              placeholder="Ex. Fièvre, douleurs abdominales…"
            />
            <Button type="submit" disabled={enCours}>
              {enCours ? 'Validation…' : 'Valider le code'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {resultat?.ok && (
        <Card className="border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <CardContent className="space-y-2 py-5">
            <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
              Dossier de soins ouvert
            </p>
            <p className="text-sm">
              Numéro de traitement :{' '}
              <span className="font-mono font-medium">
                {resultat.numeroTraitement}
              </span>
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link
                href={`/dashboard-centre-medical/medecin/${resultat.dossierId}`}
              >
                Ouvrir le dossier
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {resultat && !resultat.ok && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="space-y-2 py-5">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <XCircle className="size-5" />
              Validation refusée
            </p>
            <p className="text-sm text-destructive">{resultat.error}</p>
            {resultat.blocages.length > 0 && (
              <ul className="ml-5 list-disc space-y-1 text-sm text-destructive">
                {resultat.blocages.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
