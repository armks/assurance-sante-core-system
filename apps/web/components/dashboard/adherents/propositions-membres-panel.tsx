'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  proposerAdherentMembre,
  proposerBeneficiaireMembre,
  rejeterPropositionMembre,
  retirerPropositionMembre,
  validerPropositionMembre,
} from '@/app/dashboard-societe/propositions-membres-actions';
import {
  Alerte,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
  type ResultatSoumission,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIENS_PARENTE, SEXES } from '@/lib/member';
import { ChampsContactsBeneficiaire } from './champs-contacts';
import type { AdherentListe, PoliceRef, PropositionMembre } from './types';

const LIBELLE_STATUT: Record<string, string> = {
  EN_ATTENTE: 'En attente de l’assureur',
  VALIDEE: 'Validée',
  REJETEE: 'Rejetée',
  RETIREE: 'Retirée',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  EN_ATTENTE: 'attention',
  VALIDEE: 'succes',
  REJETEE: 'danger',
  RETIREE: 'neutre',
};
const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

function ChampsAdherent({ polices, entrant = false }: { polices: PoliceRef[]; entrant?: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampSelect name="sexe" label="Sexe" required placeholder="Choisir…" options={SEXES} />
        <ChampTexte name="dateNaissance" label="Date de naissance" type="date" required />
      </div>
      <ChampSelect
        name="policeId"
        label="Formule rattachée"
        required
        placeholder={polices.length > 0 ? 'Choisir une formule…' : 'Aucune police active pour votre société'}
        options={polices.map((p) => ({ valeur: p.id, libelle: `${p.numeroPolice} · ${p.produit ? p.produit.nom : '—'}` }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="telephone" label="Téléphone" maxLength={20} aide="Au moins un des deux contacts ; les deux sont recommandés." />
        <ChampTexte name="email" label="E-mail" type="email" maxLength={200} />
      </div>
      {entrant && (
        <ChampTexte
          name="moisEffet"
          label="Mois d’effet"
          type="month"
          aide="Laisser vide pour une prise d’effet à la validation. Sinon, l’adhérent est facturé à partir de ce mois."
        />
      )}
    </>
  );
}

function ChampsBeneficiaire({ adherents }: { adherents: AdherentListe[] }) {
  return (
    <>
      <ChampSelect
        name="adherentId"
        label="Adhérent titulaire"
        required
        placeholder="Choisir…"
        options={adherents.map((a) => ({ valeur: a.id, libelle: `${a.nom} ${a.prenom} (${a.numeroAdherent})` }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampSelect name="lienParente" label="Lien de parenté" required placeholder="Choisir…" options={LIENS_PARENTE} />
        <ChampSelect name="sexe" label="Sexe" required placeholder="Choisir…" options={SEXES} />
      </div>
      <ChampTexte name="dateNaissance" label="Date de naissance" type="date" required />
      <ChampsContactsBeneficiaire />
    </>
  );
}

const lire = (fd: FormData, k: string) => String(fd.get(k) ?? '');

/** "AAAA-MM" (input type=month) → "AAAA-MM-01" attendu par l'API ; vide = effet immédiat. */
const moisEffetISO = (fd: FormData) => (lire(fd, 'moisEffet') ? `${lire(fd, 'moisEffet')}-01` : undefined);

const moisFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const libelleType = (p: PropositionMembre) =>
  p.type === 'ADHERENT' ? (p.moisEffet ? `Entrant (effet ${moisFr(p.moisEffet)})` : 'Adhérent') : `Bénéficiaire (${p.lienParente ?? ''})`;

/** Soumission commune « adhérent » / « entrant » : l'entrant porte un mois d'effet. */
async function soumettreAdherent(fd: FormData, entrant: boolean): Promise<ResultatSoumission> {
  const r = await proposerAdherentMembre({
    nom: lire(fd, 'nom'), prenom: lire(fd, 'prenom'), dateNaissance: lire(fd, 'dateNaissance'), sexe: lire(fd, 'sexe'),
    policeId: lire(fd, 'policeId'), telephone: lire(fd, 'telephone') || undefined, email: lire(fd, 'email') || undefined,
    ...(entrant ? { moisEffet: moisEffetISO(fd) } : {}),
  });
  return r.ok
    ? { ok: true, message: entrant ? 'Entrant proposé — en attente de validation.' : 'Proposition envoyée à l’assureur.' }
    : { ok: false, error: r.error, erreurs: r.erreurs };
}

/** Bouton « Proposer un entrant » (prise d'effet différée) — réutilisé par l'écran des mouvements. */
export function BoutonProposerEntrant({ polices, onSucces }: { polices: PoliceRef[]; onSucces?: () => void }) {
  return (
    <FormulaireModal
      titre="Proposer un entrant"
      description="Prend effet au mois indiqué (coupure de facturation). Rien n’est créé tant que l’assureur n’a pas validé."
      declencheurLabel="Proposer un entrant"
      libelleSoumettre="Proposer"
      onSoumettre={(fd) => soumettreAdherent(fd, true)}
      onSucces={onSucces}
    >
      <ChampsAdherent polices={polices} entrant />
    </FormulaireModal>
  );
}

/**
 * Propositions d'adhérents et de bénéficiaires.
 *  - `mode="societe"` : la société PROPOSE (rien n'est créé avant la validation de l'assureur), suit le statut de ses propositions, voit
 *    le motif d'un rejet et peut retirer une proposition en attente.
 *  - `mode="assureur"` : l'assureur valide ou rejette (motif obligatoire).
 * Les boutons suivent « action possible ? » : le verdict vient du serveur (rôle, statut) ; l'API reste seule juge.
 */
export function PropositionsMembresPanel({
  mode,
  propositions,
  polices = [],
  adherents = [],
  basePathFiche,
  peutProposer = true,
}: {
  mode: 'societe' | 'assureur';
  propositions: PropositionMembre[];
  polices?: PoliceRef[];
  adherents?: AdherentListe[];
  /** Page de liste des adhérents : une proposition validée y renvoie à la fiche (lien d'invitation « créer son profil »). */
  basePathFiche?: string;
  /** Société : lecture seule (ex. réception) → pas de boutons de proposition. */
  peutProposer?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [rejet, setRejet] = useState<PropositionMembre | null>(null);
  const [pending, start] = useTransition();
  const enAttente = propositions.filter((p) => p.statut === 'EN_ATTENTE').length;

  const executer = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, succes: string) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, texte: succes } : { ok: false, texte: r.error });
      if (r.ok) router.refresh();
    });

  const colonnes: ColonneTable<PropositionMembre>[] = [
    { cle: 'nom', entete: 'Personne', triable: true, valeur: (p) => `${p.nom} ${p.prenom}`, rendu: (p) => <span className="font-medium">{p.prenom} {p.nom}</span> },
    { cle: 'type', entete: 'Type', valeur: libelleType, rendu: libelleType },
    ...(mode === 'assureur' ? [{ cle: 'societe', entete: 'Société', valeur: (p: PropositionMembre) => p.societe ?? '—', rendu: (p: PropositionMembre) => p.societe ?? '—' } as ColonneTable<PropositionMembre>] : []),
    { cle: 'formule', entete: 'Formule', valeur: (p) => p.formule ?? '—', rendu: (p) => p.formule ?? '—' },
    {
      cle: 'contact',
      entete: 'Contact',
      valeur: (p) => [p.email, p.telephone].filter(Boolean).join(' · ') || '—',
      rendu: (p) => [p.email, p.telephone].filter(Boolean).join(' · ') || '—',
    },
    { cle: 'dateProposition', entete: 'Proposée le', triable: true, valeur: (p) => p.dateProposition, rendu: (p) => dateFr(p.dateProposition) },
    {
      cle: 'statut',
      entete: 'Statut',
      rendu: (p) => (
        <div className="space-y-1">
          <StatutBadge statut={p.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
          {p.statut === 'REJETEE' && p.motifRejet && (
            <p className="max-w-xs text-xs text-destructive" data-testid="motif-rejet">Motif : {p.motifRejet}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card data-testid="panneau-propositions">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">
          {mode === 'societe' ? 'Mes propositions d’adhérents et de bénéficiaires' : 'Propositions des sociétés clientes'}
          {enAttente > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({enAttente} en attente)</span>}
        </CardTitle>
        {mode === 'societe' && peutProposer && (
          <div className="flex flex-wrap gap-2">
            <FormulaireModal
              titre="Proposer un adhérent"
              description="Rien n’est créé tant que l’assureur n’a pas validé votre proposition."
              declencheurLabel="Proposer un adhérent"
              libelleSoumettre="Envoyer la proposition"
              onSoumettre={(fd) => soumettreAdherent(fd, false)}
              onSucces={() => router.refresh()}
            >
              <ChampsAdherent polices={polices} />
            </FormulaireModal>
            <BoutonProposerEntrant polices={polices} onSucces={() => router.refresh()} />
            <FormulaireModal
              titre="Proposer un bénéficiaire"
              description="Rattaché à un adhérent déjà créé de votre société ; validé par l’assureur."
              declencheurLabel="Proposer un bénéficiaire"
              libelleSoumettre="Envoyer la proposition"
              onSoumettre={async (fd): Promise<ResultatSoumission> => {
                const r = await proposerBeneficiaireMembre({
                  adherentId: lire(fd, 'adherentId'), lienParente: lire(fd, 'lienParente'), nom: lire(fd, 'nom'), prenom: lire(fd, 'prenom'),
                  dateNaissance: lire(fd, 'dateNaissance'), sexe: lire(fd, 'sexe'),
                  telephone: lire(fd, 'telephone') || undefined, email: lire(fd, 'email') || undefined,
                });
                return r.ok ? { ok: true, message: 'Proposition envoyée à l’assureur.' } : { ok: false, error: r.error, erreurs: r.erreurs };
              }}
              onSucces={() => router.refresh()}
            >
              <ChampsBeneficiaire adherents={adherents} />
            </FormulaireModal>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <Alerte ton={message.ok ? 'succes' : 'erreur'} titre={message.ok ? 'Fait' : 'Action impossible'}>
            <p className="text-sm" data-testid="message-proposition">{message.texte}</p>
          </Alerte>
        )}
        {rejet && (
          <FormulaireModal
            titre={`Rejeter la proposition de ${rejet.prenom} ${rejet.nom}`}
            description="Le motif est communiqué à la société."
            libelleSoumettre="Rejeter"
            ouvert
            onOuvertChange={(v) => !v && setRejet(null)}
            onSoumettre={async (fd): Promise<ResultatSoumission> => {
              const r = await rejeterPropositionMembre(rejet.id, lire(fd, 'motif'));
              return r.ok ? { ok: true, message: 'Proposition rejetée.' } : { ok: false, error: r.error, erreurs: r.erreurs };
            }}
            onSucces={() => { setRejet(null); router.refresh(); }}
          >
            <ChampTexte name="motif" label="Motif du rejet" required maxLength={400} />
          </FormulaireModal>
        )}
        <DataTable
          donnees={propositions}
          cleLigne={(p) => p.id}
          parPage={10}
          recherche={{ placeholder: 'Nom, prénom, e-mail…', champs: ['nom', 'prenom', 'email', 'societe'] }}
          filtres={[
            {
              cle: 'statut',
              libelle: 'Statut',
              options: Object.entries(LIBELLE_STATUT).map(([valeur, libelle]) => ({ valeur, libelle })),
            },
            {
              cle: 'type',
              libelle: 'Type',
              options: [{ valeur: 'ADHERENT', libelle: 'Adhérent' }, { valeur: 'BENEFICIAIRE', libelle: 'Bénéficiaire' }],
            },
          ]}
          colonnes={colonnes}
          vide="Aucune proposition."
          actionLigne={(p) => {
            const bouton = (cle: 'valider' | 'rejeter' | 'retirer') => p.actions[cle];
            return (
              <span className="flex flex-wrap justify-end gap-2">
                {mode === 'assureur' && (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!bouton('valider').possible || pending}
                      title={bouton('valider').raison ?? undefined}
                      onClick={() => executer(() => validerPropositionMembre(p.id), `Proposition de ${p.prenom} ${p.nom} validée : ${p.type === 'ADHERENT' ? 'adhérent créé et validé, carte générée' : 'bénéficiaire créé, carte générée'}.`)}
                      data-testid={`valider-${p.id}`}
                    >
                      Valider
                    </Button>
                    <Button size="xs" variant="ghost" disabled={!bouton('rejeter').possible || pending} title={bouton('rejeter').raison ?? undefined} onClick={() => setRejet(p)} data-testid={`rejeter-${p.id}`}>
                      Rejeter
                    </Button>
                  </>
                )}
                {p.statut === 'VALIDEE' && p.type === 'ADHERENT' && p.adherentCreeId && basePathFiche && (
                  <Button asChild size="xs" variant="outline">
                    <Link href={`${basePathFiche}/${p.adherentCreeId}`}>Fiche · lien d’invitation</Link>
                  </Button>
                )}
                {mode === 'societe' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!bouton('retirer').possible || pending}
                    title={bouton('retirer').raison ?? undefined}
                    onClick={() => executer(() => retirerPropositionMembre(p.id), 'Proposition retirée.')}
                    data-testid={`retirer-${p.id}`}
                  >
                    Retirer
                  </Button>
                )}
              </span>
            );
          }}
        />
      </CardContent>
    </Card>
  );
}
