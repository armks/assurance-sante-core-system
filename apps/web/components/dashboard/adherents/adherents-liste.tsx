'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

import {
  archiverAdherent,
  creerAdherent,
  desarchiverAdherent,
  supprimerAdherent,
} from '@/app/dashboard-assureur/adherents-actions';
import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import { useState } from 'react';

import {
  Alerte,
  CarteResume,
  ConfirmationAction,
  DataTable,
  FormulaireModal,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { BandeauLienInvitation, genererLienInvitation, type LienInvitation } from './lien-invitation';
import {
  LIBELLE_STATUT_MEMBRE,
  STATUTS_MEMBRE_FILTRE,
  TON_STATUT_MEMBRE,
} from '@/lib/member';
import { ChampsNouvelAdherent } from './champs-nouvel-adherent';
import type { AdherentListe, OptionRef, PoliceRef } from './types';

export function AdherentsListe({
  adherents: adherentsEntrants,
  souscripteurs,
  polices,
  peutCreer,
  basePath,
  souscripteurVerrou,
  verdicts = {},
  estSociete = false,
  peutInviter = false,
}: {
  adherents: AdherentListe[];
  souscripteurs: OptionRef[];
  polices: PoliceRef[];
  peutCreer: boolean;
  basePath: string;
  souscripteurVerrou?: string;
  /** Verdicts « action possible ? » par adhérent (boutons grisés avec la raison). */
  verdicts?: VerdictsListe;
  /** Rôle société : « Archiver » PROPOSE la sortie (validée par l'assureur). */
  estSociete?: boolean;
  /** Rôle autorisé à générer le lien d'invitation « créer son profil » (case du formulaire). */
  peutInviter?: boolean;
}) {
  const router = useRouter();
  // La société PROPOSE (panneau des propositions) : seul l'assureur crée directement un adhérent.
  const peutAjouter = peutCreer && !estSociete;
  const [lienInvitation, setLienInvitation] = useState<LienInvitation | null>(null);
  const [avertissement, setAvertissement] = useState<string | null>(null);
  const [voirArchives, setVoirArchives] = useState(false);
  let adherents = adherentsEntrants;
  const tous = adherentsEntrants;
  const nbArchives = tous.filter((a) => a.statut === 'RADIE').length;
  adherents = voirArchives ? tous : tous.filter((a) => a.statut !== 'RADIE');
  const parStatut = (s: string) => tous.filter((a) => a.statut === s).length;

  const colonnes: ColonneTable<AdherentListe>[] = [
    { cle: 'numeroAdherent', entete: 'N° adhérent', triable: true },
    {
      cle: 'nom',
      entete: 'Nom / prénom',
      triable: true,
      valeur: (a) => `${a.nom} ${a.prenom}`,
      rendu: (a) => (
        <span className="font-medium">{`${a.nom} ${a.prenom}`}</span>
      ),
    },
    {
      cle: 'souscripteur',
      entete: 'Souscripteur / police',
      valeur: (a) => a.souscripteur?.nom ?? '',
      rendu: (a) => (
        <div className="text-sm">
          <span>{a.souscripteur?.nom ?? '—'}</span>
          {a.police && (
            <span className="block text-xs text-muted-foreground">
              {a.police.numeroPolice}
              {a.police.produit ? ` · ${a.police.produit.nom}` : ''}
            </span>
          )}
        </div>
      ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (a) => (
        <StatutBadge
          statut={a.statut}
          map={TON_STATUT_MEMBRE}
          libelles={LIBELLE_STATUT_MEMBRE}
        />
      ),
    },
    {
      cle: 'numeroCarte',
      entete: 'N° carte',
      rendu: (a) => <span className="font-mono text-xs">{a.numeroCarte}</span>,
    },
    {
      cle: 'beneficiaires',
      entete: 'Bénéf.',
      aligneDroite: true,
      valeur: (a) => a._count?.beneficiaires ?? 0,
      rendu: (a) => a._count?.beneficiaires ?? 0,
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Adhérents" valeur={adherents.length} icon={Users} />
        <CarteResume libelle="Actifs" valeur={parStatut('ACTIF')} />
        <CarteResume libelle="Suspendus" valeur={parStatut('SUSPENDU')} />
        <CarteResume libelle="Radiés" valeur={parStatut('RADIE')} />
      </GrilleCartes>

      {lienInvitation && <BandeauLienInvitation lien={lienInvitation} onFermer={() => setLienInvitation(null)} />}
      {avertissement && (
        <Alerte ton="avertissement" titre="Adhérent créé, lien d’invitation non généré">
          {avertissement} Vous pouvez le générer depuis la fiche de l’adhérent.
        </Alerte>
      )}

      {nbArchives > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} />
          Archivés ({nbArchives})
        </label>
      )}

      <DataTable
        donnees={adherents}
        cleLigne={(a) => a.id}
        parPage={15}
        recherche={{
          placeholder: 'Nom, prénom, n° adhérent, formule…',
          champs: ['nom', 'prenom', 'numeroAdherent', 'souscripteur.nom', 'police.produit.nom'],
        }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: STATUTS_MEMBRE_FILTRE.map((s) => ({
              valeur: s,
              libelle: LIBELLE_STATUT_MEMBRE[s],
            })),
          },
          {
            cle: 'formule',
            libelle: 'Formule',
            valeur: (row) => (row as AdherentListe).police?.produit?.nom ?? null,
            options: Array.from(
              new Set(
                adherents
                  .map((a) => a.police?.produit?.nom)
                  .filter((nom): nom is string => Boolean(nom)),
              ),
            ).map((nom) => ({ valeur: nom, libelle: nom })),
          },
        ]}
        colonnes={colonnes}
        actions={
          peutAjouter ? (
            <FormulaireModal
              titre="Nouvel adhérent"
              description="L’adhérent est créé ACTIF ; ses numéros d’adhérent et de carte sont générés automatiquement."
              declencheurLabel="Nouvel adhérent"
              libelleSoumettre="Créer l’adhérent"
              onSoumettre={async (fd) => {
                const email = String(fd.get('email') ?? '').trim();
                const inviter = fd.get('genererInvitation') === 'on';
                setLienInvitation(null);
                setAvertissement(null);
                if (inviter && !email) {
                  return { ok: false, error: 'Renseignez l’e-mail de l’adhérent pour générer son lien d’invitation.' };
                }
                const r = await creerAdherent({
                  souscripteurId: String(fd.get('souscripteurId') ?? ''),
                  policeId: String(fd.get('policeId') ?? '') || undefined,
                  nom: String(fd.get('nom') ?? ''),
                  prenom: String(fd.get('prenom') ?? ''),
                  dateNaissance: String(fd.get('dateNaissance') ?? ''),
                  sexe: String(fd.get('sexe') ?? ''),
                  telephone: String(fd.get('telephone') ?? '').trim() || undefined,
                  email: email || undefined,
                  modePaiementPrefere:
                    String(fd.get('modePaiementPrefere') ?? '') || undefined,
                });
                if (!r.ok || !inviter || !('adherentId' in r)) return r;
                const inv = await genererLienInvitation(r.adherentId, email);
                if (inv.ok) setLienInvitation(inv.lien);
                else setAvertissement(inv.error);
                return r;
              }}
              onSucces={() => router.refresh()}
            >
              <ChampsNouvelAdherent
                souscripteurs={souscripteurs}
                polices={polices}
                souscripteurVerrou={souscripteurVerrou}
                avecInvitation={peutInviter}
              />
            </FormulaireModal>
          ) : undefined
        }
        actionLigne={(a) => {
          const nom = `l’adhérent « ${a.prenom} ${a.nom} »`;
          const nbBenef = a._count?.beneficiaires ?? 0;
          return (
            <span className="flex flex-wrap justify-end gap-2">
              <Button asChild size="xs" variant="ghost">
                <Link href={`${basePath}/${a.id}`}>Détails</Link>
              </Button>
              {estSociete && a.statut === 'PROPOSE_SORTANT' && (
                <span className="text-xs text-muted-foreground">Sortie proposée</span>
              )}
              {peutAjouter &&
                (a.statut === 'RADIE' ? (
                  !estSociete && (
                    <ConfirmationAction
                      action="desarchiver"
                      element={nom}
                      consequence="Il redevient actif. Ses bénéficiaires archivés avec lui ne sont PAS réactivés à sa place : réactivez-les un à un."
                      verifier={() => verifierAction('adherent', a.id, 'desarchiver')}
                      onConfirmer={() => desarchiverAdherent(a.id)}
                      onSucces={() => router.refresh()}
                    />
                  )
                ) : a.statut === 'PROPOSE_SORTANT' && estSociete ? (
                  <span className="text-xs text-muted-foreground">Sortie proposée</span>
                ) : (
                  <ConfirmationAction
                    action="archiver"
                    element={nom}
                    consequence={
                      (estSociete
                        ? 'Votre société PROPOSE sa sortie : l’assureur doit la valider. '
                        : 'Il sort du fichier (statut radié) et perd l’accès au parcours de soins. ') +
                      (nbBenef > 0
                        ? `Ses ${nbBenef} bénéficiaire${nbBenef > 1 ? 's' : ''} ${estSociete ? 'seront archivés' : 'sont archivés'} avec lui.`
                        : 'Il n’a aucun bénéficiaire.')
                    }
                    verifier={() => verifierAction('adherent', a.id, 'archiver')}
                    onConfirmer={() => archiverAdherent(a.id)}
                    onSucces={() => router.refresh()}
                  />
                ))}
              {peutAjouter && (
                <ConfirmationAction
                  action="supprimer"
                  element={nom}
                  consequence="Suppression logique, tracée, possible uniquement sans aucun lien (bénéficiaire, dossier, réclamation, facture, cotisation, code, compte)."
                  verifier={() => verifierAction('adherent', a.id, 'supprimer')}
                  onConfirmer={() => supprimerAdherent(a.id)}
                  onSucces={() => router.refresh()}
                />
              )}
            </span>
          );
        }}
        vide="Aucun adhérent pour l’instant."
      />
    </div>
  );
}
