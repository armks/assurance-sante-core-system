'use client';

import { Inbox, MailWarning, CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { marquerDemandeTraitee } from '@/app/dashboard-assureur/informatique/demandes-adhesion/actions';
import {
  CarteResume,
  DataTable,
  GrilleCartes,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface DemandeAdhesion {
  id: string;
  nomSociete: string;
  nombreEstime: number;
  email: string;
  telephone: string;
  objet: string;
  message: string | null;
  statut: 'NOUVEAU' | 'TRAITE';
  /** null : envoi pas encore tenté (ou suivi non enregistré). */
  emailEnvoye: boolean | null;
  traiteLe: string | null;
  createdAt: string;
}

const LIBELLE_STATUT: Record<string, string> = { NOUVEAU: 'Nouvelle', TRAITE: 'Traitée' };
const TON_STATUT: Record<string, 'attention' | 'succes'> = { NOUVEAU: 'attention', TRAITE: 'succes' };
const dateHeure = (d: string) =>
  new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function DemandesAdhesionEcran({ demandes }: { demandes: DemandeAdhesion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  const nouvelles = demandes.filter((d) => d.statut === 'NOUVEAU').length;
  const sansEmail = demandes.filter((d) => d.emailEnvoye === false).length;

  const colonnes: ColonneTable<DemandeAdhesion>[] = [
    {
      cle: 'createdAt',
      entete: 'Reçue le',
      triable: true,
      valeur: (d) => d.createdAt,
      rendu: (d) => dateHeure(d.createdAt),
    },
    {
      cle: 'nomSociete',
      entete: 'Société / mutuelle',
      triable: true,
      rendu: (d) => (
        <span className="flex flex-col">
          <span className="font-medium">{d.nomSociete}</span>
          <span className="text-xs text-muted-foreground">{d.objet}</span>
        </span>
      ),
    },
    {
      cle: 'nombreEstime',
      entete: 'Effectif estimé',
      aligneDroite: true,
      triable: true,
      valeur: (d) => d.nombreEstime,
      rendu: (d) => d.nombreEstime.toLocaleString('fr-FR'),
    },
    {
      cle: 'email',
      entete: 'Contact',
      rendu: (d) => (
        <span className="flex flex-col text-sm">
          <a href={`mailto:${d.email}`} className="underline-offset-4 hover:underline">
            {d.email}
          </a>
          <a href={`tel:${d.telephone.replace(/\s/g, '')}`} className="text-muted-foreground">
            {d.telephone}
          </a>
        </span>
      ),
    },
    {
      cle: 'message',
      entete: 'Message',
      rendu: (d) =>
        d.message ? (
          <span className="line-clamp-3 max-w-[40ch] whitespace-pre-line text-sm" title={d.message}>
            {d.message}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      cle: 'emailEnvoye',
      entete: 'E-mail',
      rendu: (d) =>
        d.emailEnvoye === false ? (
          <StatutBadge statut="NON_ENVOYE" ton="danger" libelle="Non envoyé" />
        ) : d.emailEnvoye ? (
          <StatutBadge statut="ENVOYE" ton="neutre" libelle="Envoyé" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (d) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatutBadge statut={d.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {d.traiteLe && (
            <span className="text-xs text-muted-foreground">le {dateHeure(d.traiteLe)}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <GrilleCartes>
        <CarteResume libelle="Demandes reçues" valeur={demandes.length} icon={Inbox} />
        <CarteResume
          libelle="À traiter"
          valeur={nouvelles}
          icon={CheckCheck}
          tonIndice={nouvelles > 0 ? 'negatif' : 'neutre'}
          indice={nouvelles > 0 ? 'Nouvelles demandes en attente' : 'Tout est traité'}
        />
        <CarteResume
          libelle="E-mail non envoyé"
          valeur={sansEmail}
          icon={MailWarning}
          indice="Demandes conservées malgré l’échec de l’e-mail"
        />
      </GrilleCartes>

      {retour && (
        <p
          role={retour.ok ? 'status' : 'alert'}
          className={retour.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-destructive'}
        >
          {retour.texte}
        </p>
      )}

      <DataTable
        donnees={demandes}
        cleLigne={(d) => d.id}
        parPage={20}
        recherche={{ placeholder: 'Société, e-mail, téléphone…', champs: ['nomSociete', 'email', 'telephone', 'objet'] }}
        filtres={[
          {
            cle: 'statut',
            libelle: 'Statut',
            options: [
              { valeur: 'NOUVEAU', libelle: 'Nouvelles' },
              { valeur: 'TRAITE', libelle: 'Traitées' },
            ],
          },
        ]}
        colonnes={colonnes}
        actionLigne={(d) =>
          d.statut === 'NOUVEAU' ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await marquerDemandeTraitee(d.id);
                  setRetour(r.ok ? { ok: true, texte: r.message } : { ok: false, texte: r.error });
                  if (r.ok) router.refresh();
                })
              }
            >
              Marquer traitée
            </Button>
          ) : null
        }
        vide="Aucune demande d’adhésion reçue pour l’instant."
      />
    </div>
  );
}
