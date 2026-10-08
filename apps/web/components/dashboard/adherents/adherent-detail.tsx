'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  ajouterBeneficiaire,
  archiverAdherent,
  archiverBeneficiaire,
  changerStatutAdherent,
  changerStatutBeneficiaire,
  desarchiverAdherent,
  desarchiverBeneficiaire,
  modifierAdherent,
  modifierBeneficiaire,
  supprimerAdherent,
  supprimerBeneficiaire,
  televerserPhotoAdherentPersonnel,
  televerserPhotoBeneficiairePersonnel,
  validerAdherent,
  validerBeneficiaireAssureur,
  validerBeneficiaireSociete,
} from '@/app/dashboard-assureur/adherents-actions';
import { verifierAction } from '@/app/dependances-actions';
import {
  ChampSelect,
  ChampTexte,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_BENEFICIAIRE,
  LIBELLE_STATUT_MEMBRE,
  LIENS_PARENTE,
  SEXES,
  STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR,
  STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE,
  STATUTS_MEMBRE,
  TON_STATUT_BENEFICIAIRE,
  TON_STATUT_MEMBRE,
} from '@/lib/member';
import { CarteBouton } from './carte-bouton';
import { Medaillon } from './medaillon';
import { PhotoUploader } from './photo-uploader';
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
  peutValider = false,
  peutValiderBeneficiaireSociete: peutValiderSociete = false,
  peutValiderBeneficiaireAssureur: peutValiderAssureur = false,
  peutModifierPhoto = false,
  photoAdherentUrl = null,
  photosParBeneficiaire = {},
  estSociete = false,
  retourHref,
}: {
  adherent: AdherentDetailType;
  peutGerer: boolean;
  /** ASSUREUR_EXPLOITATION exclusivement — distinct de `peutGerer`. */
  peutValider?: boolean;
  /** SOCIETE_ADMINISTRATION — 1re validation d'un bénéficiaire proposé par
   * l'adhérent lui-même (EN_ATTENTE_SOCIETE → EN_ATTENTE_ASSUREUR). */
  peutValiderBeneficiaireSociete?: boolean;
  /** ASSUREUR_INFORMATIQUE/EXPLOITATION — 2e et dernière validation
   * (EN_ATTENTE_ASSUREUR → ACTIF, carte générée à ce moment). */
  peutValiderBeneficiaireAssureur?: boolean;
  /** ASSUREUR_INFORMATIQUE/EXPLOITATION — photo de l'adhérent et de ses
   * bénéficiaires (mêmes endpoints et même dossier famille que le self-service). */
  peutModifierPhoto?: boolean;
  /** URLs signées courte durée, résolues côté serveur par la page
   * (`chargerPhotosFamille`). Affichées à tout lecteur de la fiche ;
   * modifiables seulement si `peutModifierPhoto`. */
  photoAdherentUrl?: string | null;
  photosParBeneficiaire?: Record<string, string | null>;
  /** Rôle société : « Archiver » PROPOSE la sortie (validée par l'assureur). */
  estSociete?: boolean;
  /** Page de liste où revenir après une suppression. */
  retourHref?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = adherent.statut === 'ACTIF';

  const colBenef: ColonneTable<Beneficiaire>[] = [
    {
      cle: 'photoUrl',
      entete: 'Photo',
      rendu: (b) => {
        const url = photosParBeneficiaire[b.id] ?? null;
        const nom = `${b.nom} ${b.prenom}`;
        return peutModifierPhoto ? (
          <PhotoUploader
            compact
            url={url}
            libelle={url ? 'Modifier la photo' : 'Ajouter la photo'}
            nomPersonne={nom}
            onUpload={(fd) => televerserPhotoBeneficiairePersonnel(adherent.id, b.id, fd)}
          />
        ) : (
          <Medaillon url={url} nom={nom} taille="sm" />
        );
      },
    },
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
      rendu: (b) => (
        <span className="font-mono text-xs">{b.numeroCarte ?? '—'}</span>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (b) => (
        <StatutBadge
          statut={b.statut}
          map={TON_STATUT_BENEFICIAIRE}
          libelles={LIBELLE_STATUT_BENEFICIAIRE}
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
          <div className="pb-3">
            {peutModifierPhoto ? (
              <PhotoUploader
                url={photoAdherentUrl}
                libelle={photoAdherentUrl ? 'Modifier la photo' : 'Ajouter la photo'}
                nomPersonne={`${adherent.nom} ${adherent.prenom}`}
                onUpload={(fd) => televerserPhotoAdherentPersonnel(adherent.id, fd)}
              />
            ) : (
              <Medaillon url={photoAdherentUrl} nom={`${adherent.nom} ${adherent.prenom}`} />
            )}
          </div>
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
            {adherent.sexe === 'F' ? 'Féminin' : adherent.sexe === 'M' ? 'Masculin' : 'Non renseigné'}
          </Ligne>
          <Ligne label="Téléphone">{adherent.telephone}</Ligne>
          <Ligne label="Email">{adherent.email}</Ligne>
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
          <Ligne label="Validation (facturation)">
            {adherent.dateValidation ? (
              `Validé le ${dateFr(adherent.dateValidation)}`
            ) : peutValider ? (
              <Button
                size="xs"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setErreur(null);
                    const r = await validerAdherent(adherent.id);
                    if (r.ok) router.refresh();
                    else setErreur(r.error);
                  })
                }
              >
                Valider cet adhérent
              </Button>
            ) : (
              'Non validé'
            )}
          </Ligne>
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
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">Gestion de l’adhérent :</p>
              <div className="flex flex-wrap gap-2">
                <FormulaireModal
                  titre="Modifier l’adhérent"
                  description="Le numéro d’adhérent et le numéro de carte ne changent jamais."
                  declencheur={
                    <Button size="sm" variant="outline" disabled={pending || adherent.statut === 'RADIE'} title={adherent.statut === 'RADIE' ? 'Adhérent archivé : désarchivez-le d’abord.' : undefined}>
                      Modifier
                    </Button>
                  }
                  libelleSoumettre="Enregistrer"
                  onSoumettre={async (fd) =>
                    modifierAdherent(adherent.id, {
                      nom: String(fd.get('nom') ?? ''),
                      prenom: String(fd.get('prenom') ?? ''),
                      dateNaissance: String(fd.get('dateNaissance') ?? ''),
                    })
                  }
                  onSucces={() => router.refresh()}
                >
                  <ChampTexte name="nom" label="Nom" required defaultValue={adherent.nom} />
                  <ChampTexte name="prenom" label="Prénom" required defaultValue={adherent.prenom} />
                  <ChampTexte name="dateNaissance" label="Date de naissance" type="date" required defaultValue={adherent.dateNaissance?.slice(0, 10)} />
                </FormulaireModal>
                {(adherent.statut === 'ACTIF' || adherent.statut === 'SUSPENDU') && (
                  <FormulaireModal
                    titre={adherent.statut === 'ACTIF' ? 'Suspendre l’adhérent' : 'Réactiver l’adhérent'}
                    mode="center"
                    description={
                      adherent.statut === 'ACTIF'
                        ? 'Un adhérent suspendu perd l’accès au parcours de soins et sa carte devient indisponible.'
                        : 'L’adhérent retrouve tous ses droits.'
                    }
                    declencheur={
                      <Button size="sm" variant="outline" disabled={pending}>
                        {adherent.statut === 'ACTIF' ? 'Suspendre' : 'Réactiver'}
                      </Button>
                    }
                    libelleSoumettre="Confirmer"
                    onSoumettre={async (fd) => {
                      const cible = adherent.statut === 'ACTIF' ? 'SUSPENDU' : 'ACTIF';
                      const r = await changerStatutAdherent(adherent.id, {
                        statut: cible,
                        motif: String(fd.get('motif') ?? '') || undefined,
                      });
                      if (!r.ok) return { ok: false, error: r.error, erreurs: [] };
                      return { ok: true, message: `Statut → ${LIBELLE_STATUT_MEMBRE[r.statut] ?? r.statut}.` };
                    }}
                    onSucces={() => router.refresh()}
                  >
                    <ChampTexte name="motif" label="Motif" maxLength={400} aide="Optionnel — tracé dans l’audit." />
                  </FormulaireModal>
                )}
                {adherent.statut === 'RADIE' ? (
                  !estSociete && (
                    <ConfirmationAction
                      action="desarchiver"
                      element={`l’adhérent « ${adherent.prenom} ${adherent.nom} »`}
                      consequence="Il redevient actif. Ses bénéficiaires archivés avec lui ne sont PAS réactivés à sa place : réactivez-les un à un."
                      verifier={() => verifierAction('adherent', adherent.id, 'desarchiver')}
                      onConfirmer={() => desarchiverAdherent(adherent.id)}
                      onSucces={() => router.refresh()}
                      declencheur={<Button size="sm" variant="outline">Désarchiver</Button>}
                    />
                  )
                ) : adherent.statut === 'PROPOSE_SORTANT' && estSociete ? (
                  <span className="self-center text-xs text-muted-foreground">Sortie proposée : en attente de l’assureur.</span>
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={`l’adhérent « ${adherent.prenom} ${adherent.nom} »`}
                    consequence={
                      (estSociete
                        ? 'Votre société PROPOSE sa sortie : l’assureur doit la valider. '
                        : 'Il sort du fichier (statut radié) et perd l’accès au parcours de soins. ') +
                      (adherent.beneficiaires.filter((b) => b.statut !== 'RADIE').length > 0
                        ? `Ses ${adherent.beneficiaires.filter((b) => b.statut !== 'RADIE').length} bénéficiaire(s) ${estSociete ? 'seront archivés' : 'sont archivés'} avec lui.`
                        : 'Il n’a aucun bénéficiaire actif.')
                    }
                    verifier={() => verifierAction('adherent', adherent.id, 'archiver')}
                    onConfirmer={() => archiverAdherent(adherent.id)}
                    onSucces={() => router.refresh()}
                    declencheur={<Button size="sm" variant="destructive">Archiver</Button>}
                  />
                )}
                <ConfirmationAction
                  action="supprimer"
                  element={`l’adhérent « ${adherent.prenom} ${adherent.nom} »`}
                  consequence="Suppression logique, tracée, possible uniquement sans aucun lien (bénéficiaire, dossier, réclamation, facture, cotisation, code, compte)."
                  verifier={() => verifierAction('adherent', adherent.id, 'supprimer')}
                  onConfirmer={() => supprimerAdherent(adherent.id)}
                  onSucces={() => router.push(retourHref ?? '/dashboard')}
                  declencheur={<Button size="sm" variant="outline">Supprimer</Button>}
                />
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
                {peutValiderSociete && b.statut === STATUT_BENEFICIAIRE_EN_ATTENTE_SOCIETE && (
                  <Button
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErreur(null);
                        const r = await validerBeneficiaireSociete(b.id);
                        if (r.ok) router.refresh();
                        else setErreur(r.error);
                      })
                    }
                  >
                    Valider (société)
                  </Button>
                )}
                {peutValiderAssureur && b.statut === STATUT_BENEFICIAIRE_EN_ATTENTE_ASSUREUR && (
                  <Button
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErreur(null);
                        const r = await validerBeneficiaireAssureur(b.id);
                        if (r.ok) router.refresh();
                        else setErreur(r.error);
                      })
                    }
                  >
                    Valider (assureur) — génère la carte
                  </Button>
                )}
                {peutGerer && (
                  <CarteBouton
                    adherentId={adherent.id}
                    beneficiaireId={b.id}
                    actif={actif && b.statut === 'ACTIF'}
                    raisonIndispo={
                      b.statut !== 'ACTIF'
                        ? `le bénéficiaire est ${
                            LIBELLE_STATUT_BENEFICIAIRE[b.statut] ?? b.statut
                          }`
                        : `l’adhérent titulaire est ${
                            LIBELLE_STATUT_MEMBRE[adherent.statut] ?? adherent.statut
                          }`
                    }
                  />
                )}
                {peutGerer && (
                  <FormulaireModal
                    titre="Modifier le bénéficiaire"
                    description="Identité de l'ayant droit."
                    declencheur={
                      <Button type="button" size="xs" variant="ghost">
                        Modifier
                      </Button>
                    }
                    libelleSoumettre="Enregistrer"
                    onSoumettre={async (fd) =>
                      modifierBeneficiaire(adherent.id, b.id, {
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
                      defaultValue={b.lienParente}
                      options={LIENS_PARENTE}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ChampTexte
                        name="nom"
                        label="Nom"
                        required
                        maxLength={120}
                        defaultValue={b.nom}
                      />
                      <ChampTexte
                        name="prenom"
                        label="Prénom"
                        required
                        maxLength={120}
                        defaultValue={b.prenom}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ChampTexte
                        name="dateNaissance"
                        label="Date de naissance"
                        type="date"
                        required
                        defaultValue={b.dateNaissance.slice(0, 10)}
                      />
                      <ChampSelect
                        name="sexe"
                        label="Sexe"
                        required
                        defaultValue={b.sexe}
                        options={SEXES}
                      />
                    </div>
                  </FormulaireModal>
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
                {peutGerer &&
                  (b.statut === 'RADIE' ? (
                    <ConfirmationAction
                      action="desarchiver"
                      element={`le bénéficiaire « ${b.prenom} ${b.nom} »`}
                      consequence="Il redevient actif, si l’adhérent titulaire n’est pas lui-même archivé."
                      verifier={() => verifierAction('beneficiaire', b.id, 'desarchiver')}
                      onConfirmer={() => desarchiverBeneficiaire(adherent.id, b.id)}
                      onSucces={() => router.refresh()}
                    />
                  ) : (
                    <ConfirmationAction
                      action="archiver"
                      element={`le bénéficiaire « ${b.prenom} ${b.nom} »`}
                      consequence="Il perd l’accès au parcours de soins ; l’historique est conservé."
                      verifier={() => verifierAction('beneficiaire', b.id, 'archiver')}
                      onConfirmer={() => archiverBeneficiaire(adherent.id, b.id)}
                      onSucces={() => router.refresh()}
                    />
                  ))}
                {peutGerer && (
                  <ConfirmationAction
                    action="supprimer"
                    element={`le bénéficiaire « ${b.prenom} ${b.nom} »`}
                    consequence="Suppression logique, tracée, possible uniquement sans dossier, réclamation, facture ni code."
                    verifier={() => verifierAction('beneficiaire', b.id, 'supprimer')}
                    onConfirmer={() => supprimerBeneficiaire(adherent.id, b.id)}
                    onSucces={() => router.refresh()}
                  />
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
