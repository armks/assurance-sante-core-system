'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  modifierMonBeneficiaire,
  proposerMonBeneficiaire,
  televerserMaPhoto,
  televerserPhotoBeneficiaire,
} from '@/app/dashboard-adherent/beneficiaires-actions';
import {
  ChampSelect,
  ChampTexte,
  FormulaireModal,
  StatutBadge,
} from '@/components/dashboard/patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_BENEFICIAIRE,
  LIENS_PARENTE,
  SEXES,
  TON_STATUT_BENEFICIAIRE,
} from '@/lib/member';
import { PhotoUploader } from '@/components/dashboard/adherents/photo-uploader';
import type { Beneficiaire } from '@/components/dashboard/adherents/types';

const LIBELLE_LIEN = Object.fromEntries(LIENS_PARENTE.map((l) => [l.valeur, l.libelle]));
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

function ChampsBeneficiaire({ beneficiaire }: { beneficiaire?: Beneficiaire }) {
  return (
    <>
      <ChampSelect
        name="lienParente"
        label="Lien de parenté"
        required
        placeholder="Choisir…"
        defaultValue={beneficiaire?.lienParente}
        options={LIENS_PARENTE}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} defaultValue={beneficiaire?.nom} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} defaultValue={beneficiaire?.prenom} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte
          name="dateNaissance"
          label="Date de naissance"
          type="date"
          required
          defaultValue={beneficiaire?.dateNaissance.slice(0, 10)}
        />
        <ChampSelect
          name="sexe"
          label="Sexe"
          required
          placeholder="Choisir…"
          defaultValue={beneficiaire?.sexe}
          options={SEXES}
        />
      </div>
    </>
  );
}

function lireDto(fd: FormData) {
  return {
    lienParente: String(fd.get('lienParente') ?? ''),
    nom: String(fd.get('nom') ?? ''),
    prenom: String(fd.get('prenom') ?? ''),
    dateNaissance: String(fd.get('dateNaissance') ?? ''),
    sexe: String(fd.get('sexe') ?? ''),
  };
}

/**
 * Écran self-service adhérent « Mes bénéficiaires » — proposition d'ajout
 * soumise à double validation (SOCIETE_ADMINISTRATION puis ASSUREUR_
 * INFORMATIQUE/EXPLOITATION) avant génération du numéro de carte. Tant que
 * `numeroCarte` est `null`, la proposition reste modifiable par l'adhérent ;
 * au-delà, ses informations sont immuables pour lui (l'API refuse
 * explicitement, cf. `modifierMonBeneficiaire`). La photo, elle, reste
 * modifiable en toute circonstance (donnée non structurante, sans validation).
 */
export function BeneficiairesEcran({
  adherentId,
  beneficiaires,
  photoAdherentUrl,
  photosParBeneficiaire,
}: {
  adherentId: string;
  beneficiaires: Beneficiaire[];
  photoAdherentUrl: string | null;
  photosParBeneficiaire: Record<string, string | null>;
}) {
  const router = useRouter();
  const [editionId, setEditionId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ma photo de profil</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoUploader
            url={photoAdherentUrl}
            onUpload={async (fd) => {
              const r = await televerserMaPhoto(adherentId, fd);
              router.refresh();
              return r;
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Bénéficiaires ({beneficiaires.length})</CardTitle>
          <FormulaireModal
            titre="Proposer un bénéficiaire"
            description="Rattaché à vous en tant que titulaire — soumis à la validation de votre société puis de l'assureur avant l'attribution d'une carte."
            declencheurLabel="Proposer un bénéficiaire"
            libelleSoumettre="Soumettre la proposition"
            onSoumettre={async (fd) => {
              const r = await proposerMonBeneficiaire(adherentId, lireDto(fd));
              if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
              return { ok: true, message: 'Proposition envoyée — en attente de validation par votre société.' };
            }}
            onSucces={() => router.refresh()}
          >
            <ChampsBeneficiaire />
          </FormulaireModal>
        </CardHeader>
        <CardContent className="space-y-3">
          {beneficiaires.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun bénéficiaire pour l’instant.</p>
          )}
          {beneficiaires.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex items-center gap-3">
                <PhotoUploader
                  url={photosParBeneficiaire[b.id] ?? null}
                  nomPersonne={`${b.nom} ${b.prenom}`}
                  onUpload={async (fd) => {
                    const r = await televerserPhotoBeneficiaire(adherentId, b.id, fd);
                    router.refresh();
                    return r;
                  }}
                />
                <div className="text-sm">
                  <p className="font-medium">
                    {b.nom} {b.prenom}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {LIBELLE_LIEN[b.lienParente] ?? b.lienParente} · {dateFr(b.dateNaissance)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {b.numeroCarte && (
                  <span className="font-mono text-xs text-muted-foreground">{b.numeroCarte}</span>
                )}
                <StatutBadge statut={b.statut} map={TON_STATUT_BENEFICIAIRE} libelles={LIBELLE_STATUT_BENEFICIAIRE} />
                {b.numeroCarte === null && (
                  <FormulaireModal
                    titre="Modifier la proposition"
                    description="Encore modifiable : la carte n'a pas encore été attribuée."
                    libelleSoumettre="Enregistrer"
                    declencheur={
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        Modifier
                      </button>
                    }
                    ouvert={editionId === b.id}
                    onOuvertChange={(v) => setEditionId(v ? b.id : null)}
                    onSoumettre={async (fd) => {
                      const r = await modifierMonBeneficiaire(adherentId, b.id, lireDto(fd));
                      return r;
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampsBeneficiaire beneficiaire={b} />
                  </FormulaireModal>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
