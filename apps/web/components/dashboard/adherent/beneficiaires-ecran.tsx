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
import { ChampsContactsBeneficiaire, lireContacts } from '@/components/dashboard/adherents/champs-contacts';
import type { AdherentDetail, Beneficiaire } from '@/components/dashboard/adherents/types';
import { FichePatient } from '@/components/dashboard/centre-medical/fiche-patient';


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
      <ChampsContactsBeneficiaire telephone={beneficiaire?.telephone} email={beneficiaire?.email} />
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
    ...lireContacts(fd),
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
  adherent,
  beneficiaires,
  photoAdherentUrl,
  photosParBeneficiaire,
}: {
  adherentId: string;
  /** Titulaire, présenté en entier dans le cadre « Ma photo de profil ». */
  adherent: AdherentDetail;
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
          <div className="flex flex-col gap-3 rounded-lg border p-2.5 sm:flex-row sm:items-stretch sm:gap-4" data-testid="fiche-titulaire">
            <FichePatient
              patient={{
                nom: adherent.nom,
                prenom: adherent.prenom,
                dateNaissance: adherent.dateNaissance,
                sexe: adherent.sexe,
                numeroCarte: adherent.numeroCarte,
                societe: adherent.souscripteur?.nom ?? null,
                photoUrl: photoAdherentUrl,
                lien: 'TITULAIRE',
                formule: adherent.police?.produit?.nom ?? null,
              }}
            />
            <div className="grid flex-1 content-between gap-y-2 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Statut de la carte</dt>
                  <dd className="font-medium">{adherent.statut}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Police</dt>
                  <dd>{adherent.police?.numeroPolice ?? '—'}</dd>
                </div>
              </dl>
              <PhotoUploader
                texteSeul
                nomPersonne={`${adherent.prenom} ${adherent.nom}`}
                url={photoAdherentUrl}
                onUpload={async (fd) => {
                  const r = await televerserMaPhoto(adherentId, fd);
                  router.refresh();
                  return r;
                }}
              />
            </div>
          </div>
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
            <div key={b.id} className="flex flex-col gap-3 rounded-lg border p-2.5 sm:flex-row sm:items-stretch sm:gap-4">
              <FichePatient
                compact
                patient={{
                  nom: b.nom,
                  prenom: b.prenom,
                  dateNaissance: b.dateNaissance,
                  sexe: b.sexe,
                  numeroCarte: b.numeroCarte,
                  societe: adherent.souscripteur?.nom ?? null,
                  photoUrl: photosParBeneficiaire[b.id] ?? null,
                  lien: b.lienParente,
                  formule: adherent.police?.produit?.nom ?? null,
                }}
              />
              <div className="grid flex-1 content-between gap-y-2 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <dt className="text-sm text-muted-foreground">Statut</dt>
                    <dd>
                      <StatutBadge statut={b.statut} map={TON_STATUT_BENEFICIAIRE} libelles={LIBELLE_STATUT_BENEFICIAIRE} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Police</dt>
                    <dd>{adherent.police?.numeroPolice ?? '—'}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <PhotoUploader
                    texteSeul
                    url={photosParBeneficiaire[b.id] ?? null}
                    nomPersonne={`${b.nom} ${b.prenom}`}
                    onUpload={async (fd) => {
                      const r = await televerserPhotoBeneficiaire(adherentId, b.id, fd);
                      router.refresh();
                      return r;
                    }}
                  />
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
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
