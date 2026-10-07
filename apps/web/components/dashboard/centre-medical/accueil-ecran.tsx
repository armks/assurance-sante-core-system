'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { CheckCircle2, Search, XCircle } from 'lucide-react';

import {
  rechercherParNumeroCarte,
  validerCodeConsultation,
  type MembreTrouve,
} from '@/app/dashboard-centre-medical/accueil/actions';
import { ChampTexte, StatutBadge } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLE_STATUT_MEMBRE, TON_STATUT_MEMBRE } from '@/lib/member';

type Resultat =
  | { ok: true; dossierId: string; numeroTraitement: string }
  | { ok: false; error: string; blocages: string[] };

type ResultatRecherche =
  | { ok: true; membre: MembreTrouve }
  | { ok: false; error: string };

function RechercheCarte() {
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<ResultatRecherche | null>(null);

  function soumettre(formData: FormData) {
    const numeroCarte = String(formData.get('numeroCarte') ?? '').trim();
    demarrer(async () => {
      setResultat(null);
      setResultat(await rechercherParNumeroCarte(numeroCarte));
    });
  }

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
          Consultation purement informative — n’ouvre aucun dossier et ne crée
          rien. Utile pour vérifier le statut d’un adhérent ou bénéficiaire
          avant de lui demander son code de consultation.
        </p>
        <form action={soumettre} className="flex flex-wrap items-end gap-4">
          <ChampTexte
            name="numeroCarte"
            label="Numéro de carte"
            required
            autoComplete="off"
            placeholder="CM-0000000042"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" disabled={enCours}>
            {enCours ? 'Recherche…' : 'Rechercher'}
          </Button>
        </form>

        {resultat?.ok && (
          <div className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {resultat.membre.prenom} {resultat.membre.nom}
                </p>
                <p className="text-sm text-muted-foreground">
                  {resultat.membre.type === 'ADHERENT_TITULAIRE'
                    ? `Adhérent titulaire · ${resultat.membre.numeroAdherent}`
                    : `Bénéficiaire (${resultat.membre.lienParente}) de ${resultat.membre.adherent.prenom} ${resultat.membre.adherent.nom}`}
                </p>
              </div>
              <StatutBadge
                statut={resultat.membre.statut}
                map={TON_STATUT_MEMBRE}
                libelles={LIBELLE_STATUT_MEMBRE}
              />
            </div>
          </div>
        )}

        {resultat && !resultat.ok && (
          <p className="text-sm text-destructive">{resultat.error}</p>
        )}
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
