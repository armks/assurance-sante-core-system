'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterBeneficiaire,
  changerStatutAdherent,
  changerStatutBeneficiaire,
} from '@/app/dashboard-assureur/adherents-actions';
import {
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_MEMBRE,
  LIENS_PARENTE,
  SEXES,
  STATUTS_MEMBRE,
  TON_STATUT_MEMBRE,
} from '@/lib/member';
import { CarteBouton } from './carte-bouton';
import type { AdherentDetail as AdherentDetailType, Beneficiaire } from './types';

const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const LIBELLE_LIEN = Object.fromEntries(
  LIENS_PARENTE.map((l) => [l.valeur, l.libelle]),
);

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '') return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function AdherentDetail({
  adherent,
  peutGerer,
}: {
  adherent: AdherentDetailType;
  peutGerer: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = adherent.statut === 'ACTIF';

  const colBenef: ColonneTable<Beneficiaire>[] = [
    {
      cle: 'nom',
      entete: 'Nom / prénom',
      valeur: (b) => `${b.nom} ${b.prenom}`,
      rendu: (b) => `${b.nom} ${b.prenom}`,
    },
    {
      cle: 'lienParente',
      entete: 'Lien',
      rendu: (b) => LIBELLE_LIEN[b.lienParente] ?? b.lienParente,
    },
    {
      cle: 'dateNaissance',
      entete: 'Naissance',
      valeur: (b) => b.dateNaissance,
      rendu: (b) => dateFr(b.dateNaissance),
    },
    {
      cle: 'numeroCarte',
      entete: 'N° carte',
      rendu: (b) => <span className="font-mono text-xs">{b.numeroCarte}</span>,
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (b) => (
        <StatutBadge
          statut={b.statut}
          map={TON_STATUT_MEMBRE}
          libelles={LIBELLE_STATUT_MEMBRE}
        />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <Ligne label="N° d’adhérent">{adherent.numeroAdherent}</Ligne>
          <Ligne label="Nom / prénom">
            {adherent.nom} {adherent.prenom}
          </Ligne>
          <Ligne label="Statut">
            <StatutBadge
              statut={adherent.statut}
              map={TON_STATUT_MEMBRE}
              libelles={LIBELLE_STATUT_MEMBRE}
            />
          </Ligne>
          <Ligne label="Date de naissance">{dateFr(adherent.dateNaissance)}</Ligne>
          <Ligne label="Sexe">
            {adherent.sexe === 'F' ? 'Féminin' : 'Masculin'}
          </Ligne>
          <Ligne label="N° de carte">
            <span className="font-mono text-xs">{adherent.numeroCarte}</span>
          </Ligne>
          <Ligne label="Souscripteur">{adherent.souscripteur?.nom}</Ligne>
          <Ligne label="Police">
            {adherent.police
              ? `${adherent.police.numeroPolice}${
                  adherent.police.produit
                    ? ` · ${adherent.police.produit.nom} v${adherent.police.produit.version}`
                    : ''
                }`
              : 'Non rattaché'}
          </Ligne>
          <Ligne label="Mode de paiement">
            {adherent.modePaiementPrefere?.replace(/_/g, ' ') ?? null}
          </Ligne>
          <Ligne label="Créé le">{dateFr(adherent.createdAt)}</Ligne>
        </CardContent>
      </Card>

      {/* --- Carte + statut --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Carte de membre & statut</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {peutGerer ? (
            <CarteBouton
              adherentId={adherent.id}
              actif={actif}
              raisonIndispo={`l’adhérent est ${
                LIBELLE_STATUT_MEMBRE[adherent.statut] ?? adherent.statut
              }`}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              N° carte : <span className="font-mono">{adherent.numeroCarte}</span>{' '}
              — la génération de carte est réservée au personnel habilité
              (assureur ou administration de votre société).
            </p>
          )}

          {peutGerer && (
            <div className="border-t pt-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Changer le statut de l’adhérent :
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUTS_MEMBRE.filter((s) => s !== adherent.statut).map((s) => (
                  <FormulaireModal
                    key={s}
                    titre={`Passer l’adhérent à « ${LIBELLE_STATUT_MEMBRE[s]} »`}
                    mode="center"
                    description={
                      s !== 'ACTIF'
                        ? 'Un adhérent non ACTIF perd l’accès au parcours de soins et sa carte devient indisponible.'
                        : 'L’adhérent retrouve tous ses droits.'
                    }
                    declencheur={
                      <Button
                        size="sm"
                        variant={s === 'RADIE' ? 'destructive' : 'outline'}
                        disabled={pending}
                      >
                        {LIBELLE_STATUT_MEMBRE[s]}
                      </Button>
                    }
                    libelleSoumettre="Confirmer"
                    onSoumettre={async (fd) => {
                      const r = await changerStatutAdherent(adherent.id, {
                        statut: s,
                        motif: String(fd.get('motif') ?? '') || undefined,
                      });
                      if (!r.ok) return { ok: false, error: r.error, erreurs: [] };
                      return { ok: true, message: `Statut → ${r.statut}.` };
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampTexte
                      name="motif"
                      label="Motif"
                      maxLength={400}
                      aide={s === 'ACTIF' ? 'Optionnel.' : 'Recommandé — tracé dans l’audit.'}
                    />
                  </FormulaireModal>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Bénéficiaires --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bénéficiaires</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            donnees={adherent.beneficiaires}
            cleLigne={(b) => b.id}
            parPage={0}
            colonnes={colBenef}
            actions={
              peutGerer ? (
                <FormulaireModal
                  titre="Ajouter un bénéficiaire"
                  description="Ayant droit rattaché à cet adhérent. Le numéro de carte est généré automatiquement."
                  declencheurLabel="Ajouter un bénéficiaire"
                  libelleSoumettre="Ajouter"
                  onSoumettre={async (fd) =>
                    ajouterBeneficiaire(adherent.id, {
                      lienParente: String(fd.get('lienParente') ?? ''),
                      nom: String(fd.get('nom') ?? ''),
                      prenom: String(fd.get('prenom') ?? ''),
                      dateNaissance: String(fd.get('dateNaissance') ?? ''),
                      sexe: String(fd.get('sexe') ?? ''),
                    })
                  }
                  onSucces={() => router.refresh()}
                >
                  <ChampSelect
                    name="lienParente"
                    label="Lien de parenté"
                    required
                    placeholder="Choisir…"
                    options={LIENS_PARENTE}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ChampTexte name="nom" label="Nom" required maxLength={120} />
                    <ChampTexte
                      name="prenom"
                      label="Prénom"
                      required
                      maxLength={120}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ChampTexte
                      name="dateNaissance"
                      label="Date de naissance"
                      type="date"
                      required
                    />
                    <ChampSelect
                      name="sexe"
                      label="Sexe"
                      required
                      placeholder="Choisir…"
                      options={SEXES}
                    />
                  </div>
                </FormulaireModal>
              ) : undefined
            }
            actionLigne={(b) => (
              <div className="flex items-center gap-2">
                {peutGerer && (
                  <CarteBouton
                    adherentId={adherent.id}
                    beneficiaireId={b.id}
                    actif={actif && b.statut === 'ACTIF'}
                    raisonIndispo={
                      b.statut !== 'ACTIF'
                        ? `le bénéficiaire est ${
                            LIBELLE_STATUT_MEMBRE[b.statut] ?? b.statut
                          }`
                        : `l’adhérent titulaire est ${
                            LIBELLE_STATUT_MEMBRE[adherent.statut] ?? adherent.statut
                          }`
                    }
                  />
                )}
                {peutGerer && b.statut !== 'RADIE' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErreur(null);
                        const r = await changerStatutBeneficiaire(
                          adherent.id,
                          b.id,
                          { statut: b.statut === 'ACTIF' ? 'SUSPENDU' : 'ACTIF' },
                        );
                        if (r.ok) router.refresh();
                        else setErreur(r.error);
                      })
                    }
                  >
                    {b.statut === 'ACTIF' ? 'Suspendre' : 'Réactiver'}
                  </Button>
                )}
              </div>
            )}
            vide="Aucun bénéficiaire."
          />
        </CardContent>
      </Card>
    </div>
  );
}
