'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  modifierPropositionAdherent,
  modifierPropositionBeneficiaire,
  proposerAdherent,
  proposerBeneficiaire,
  soumettrePourValidation,
  supprimerProposition,
} from '@/app/dashboard-societe/propositions-actions';
import {
  ChampSelect,
  ChampTexte,
  FormulaireModal,
  StatutBadge,
  type ResultatSoumission,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIENS_PARENTE, SEXES } from '@/lib/member';
import type { AdherentListe, ImportAdherentsResume, LigneImportValide } from './types';

const LIBELLE_STATUT: Record<string, string> = {
  BROUILLON: 'Brouillon',
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
};
const TON_STATUT: Record<string, 'succes' | 'attention' | 'danger' | 'neutre'> = {
  BROUILLON: 'neutre',
  EN_ATTENTE_VALIDATION: 'attention',
  VALIDE: 'succes',
  REJETE: 'danger',
};

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');

function ChampsAdherent({
  ligne,
}: {
  ligne?: { nom: string; prenom: string; telephone: string; email: string; dateNaissance: string };
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} defaultValue={ligne?.nom} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} defaultValue={ligne?.prenom} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="telephone" label="Téléphone" required maxLength={20} defaultValue={ligne?.telephone} />
        <ChampTexte name="email" label="E-mail" type="email" required maxLength={200} defaultValue={ligne?.email} />
      </div>
      <ChampTexte
        name="dateNaissance"
        label="Date de naissance"
        type="date"
        required
        defaultValue={ligne?.dateNaissance?.slice(0, 10)}
      />
    </>
  );
}

function ChampsBeneficiaire({
  adherents,
  ligne,
}: {
  adherents: AdherentListe[];
  ligne?: Extract<LigneImportValide, { type: 'BENEFICIAIRE' }>;
}) {
  return (
    <>
      <ChampSelect
        name="adherentId"
        label="Adhérent rattaché"
        required
        placeholder="Choisir…"
        defaultValue={ligne?.adherentId}
        options={adherents.map((a) => ({ valeur: a.id, libelle: `${a.nom} ${a.prenom} (${a.numeroAdherent})` }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampTexte name="nom" label="Nom" required maxLength={120} defaultValue={ligne?.nom} />
        <ChampTexte name="prenom" label="Prénom" required maxLength={120} defaultValue={ligne?.prenom} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChampSelect name="lienParente" label="Lien de parenté" required placeholder="Choisir…" defaultValue={ligne?.lienParente} options={LIENS_PARENTE} />
        <ChampSelect name="sexe" label="Sexe" required placeholder="Choisir…" defaultValue={ligne?.sexe} options={SEXES} />
      </div>
      <ChampTexte
        name="dateNaissance"
        label="Date de naissance"
        type="date"
        required
        defaultValue={ligne?.dateNaissance?.slice(0, 10)}
      />
    </>
  );
}

function lireAdherentDto(fd: FormData) {
  return {
    nom: String(fd.get('nom') ?? ''),
    prenom: String(fd.get('prenom') ?? ''),
    telephone: String(fd.get('telephone') ?? ''),
    email: String(fd.get('email') ?? ''),
    dateNaissance: String(fd.get('dateNaissance') ?? ''),
  };
}

function lireBeneficiaireDto(fd: FormData) {
  return {
    adherentId: String(fd.get('adherentId') ?? ''),
    lienParente: String(fd.get('lienParente') ?? ''),
    nom: String(fd.get('nom') ?? ''),
    prenom: String(fd.get('prenom') ?? ''),
    dateNaissance: String(fd.get('dateNaissance') ?? ''),
    sexe: String(fd.get('sexe') ?? ''),
  };
}

/**
 * Panneau « Mes propositions » — gestion collaborative société de sa liste
 * d'adhérents/bénéficiaires AVANT validation finale par l'assureur (prompt
 * dédié, s'ajoute au module `member/import-adherents.service.ts` déjà
 * construit pour l'import Excel). Le brouillon (`statut = BROUILLON`) reste
 * éditable ligne par ligne jusqu'à « Soumettre pour validation », qui bascule
 * en `EN_ATTENTE_VALIDATION` — même circuit et même écran de validation que
 * l'import Excel côté ASSUREUR_INFORMATIQUE/EXPLOITATION, sans aucune
 * distinction d'origine.
 */
export function PropositionsAdherentsPanel({
  souscripteurId,
  brouillon,
  soumis,
  adherents,
}: {
  souscripteurId: string;
  brouillon: ImportAdherentsResume | null;
  soumis: ImportAdherentsResume[];
  adherents: AdherentListe[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [editionIndex, setEditionIndex] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const lignes = brouillon?.lignesValides ?? [];

  function supprimer(index: number) {
    if (!brouillon) return;
    start(async () => {
      const r = await supprimerProposition(brouillon.id, index);
      if (r.ok) {
        setMessage(null);
        router.refresh();
      } else {
        setMessage({ ok: false, texte: r.error });
      }
    });
  }

  function soumettre() {
    if (!brouillon) return;
    start(async () => {
      const r = await soumettrePourValidation(brouillon.id);
      if (r.ok) {
        setMessage({ ok: true, texte: 'Votre liste a été soumise pour validation à l’assureur.' });
        router.refresh();
      } else {
        setMessage({ ok: false, texte: r.error });
      }
    });
  }

  async function onSoumettreAjoutAdherent(fd: FormData): Promise<ResultatSoumission> {
    const r = await proposerAdherent(souscripteurId, lireAdherentDto(fd));
    if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
    return { ok: true, message: 'Adhérent ajouté à votre brouillon.' };
  }

  async function onSoumettreAjoutBeneficiaire(fd: FormData): Promise<ResultatSoumission> {
    const r = await proposerBeneficiaire(souscripteurId, lireBeneficiaireDto(fd));
    if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
    return { ok: true, message: 'Bénéficiaire ajouté à votre brouillon.' };
  }

  async function onSoumettreEdition(index: number, ligne: LigneImportValide, fd: FormData): Promise<ResultatSoumission> {
    if (!brouillon) return { ok: false, error: 'Brouillon introuvable.' };
    const r =
      ligne.type === 'BENEFICIAIRE'
        ? await modifierPropositionBeneficiaire(brouillon.id, index, lireBeneficiaireDto(fd))
        : await modifierPropositionAdherent(brouillon.id, index, lireAdherentDto(fd));
    if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
    return { ok: true, message: 'Ligne modifiée.' };
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <CardTitle className="text-base">
          Mes propositions {brouillon ? `(${lignes.length} en brouillon)` : ''}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <FormulaireModal
            titre="Proposer un adhérent"
            description="Cette proposition reste modifiable tant que vous n'avez pas soumis votre liste pour validation."
            declencheurLabel="Proposer un adhérent"
            libelleSoumettre="Ajouter au brouillon"
            onSoumettre={onSoumettreAjoutAdherent}
            onSucces={() => router.refresh()}
          >
            <ChampsAdherent />
          </FormulaireModal>
          <FormulaireModal
            titre="Proposer un bénéficiaire"
            description="Rattaché à un adhérent déjà existant de votre société."
            declencheur={<Button size="sm" variant="outline">Proposer un bénéficiaire</Button>}
            libelleSoumettre="Ajouter au brouillon"
            onSoumettre={onSoumettreAjoutBeneficiaire}
            onSucces={() => router.refresh()}
          >
            <ChampsBeneficiaire adherents={adherents} />
          </FormulaireModal>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <p
            className={
              message.ok
                ? 'rounded-md border border-emerald-300/70 bg-emerald-50/50 p-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400'
                : 'rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive'
            }
          >
            {message.texte}
          </p>
        )}

        {lignes.length === 0 && soumis.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune proposition pour l’instant — utilisez les boutons ci-dessus pour composer votre liste.
          </p>
        )}

        {lignes.length > 0 && (
          <div className="space-y-2">
            {lignes.map((ligne, index) => (
              <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="text-sm">
                  {ligne.type === 'BENEFICIAIRE' ? (
                    <>
                      <span className="font-medium">{ligne.nom} {ligne.prenom}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        Bénéficiaire · {ligne.lienParente} de {ligne.adherentNom}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{ligne.nom} {ligne.prenom}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        Adhérent · {ligne.telephone} · {ligne.email}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <FormulaireModal
                    titre={ligne.type === 'BENEFICIAIRE' ? 'Modifier le bénéficiaire' : "Modifier l'adhérent"}
                    libelleSoumettre="Enregistrer"
                    declencheur={<Button size="xs" variant="ghost">Modifier</Button>}
                    ouvert={editionIndex === index}
                    onOuvertChange={(v) => setEditionIndex(v ? index : null)}
                    onSoumettre={(fd) => onSoumettreEdition(index, ligne, fd)}
                    onSucces={() => router.refresh()}
                  >
                    {ligne.type === 'BENEFICIAIRE' ? (
                      <ChampsBeneficiaire adherents={adherents} ligne={ligne} />
                    ) : (
                      <ChampsAdherent ligne={ligne} />
                    )}
                  </FormulaireModal>
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => supprimer(index)}>
                    Supprimer
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <Button size="sm" disabled={pending} onClick={soumettre}>
                Soumettre pour validation
              </Button>
            </div>
          </div>
        )}

        {soumis.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Listes déjà soumises</p>
            {soumis.map((imp) => (
              <div key={imp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <p className="text-sm">
                  {imp.nbLignesValides} ligne(s) · soumise le {dateFr(imp.createdAt)}
                </p>
                <StatutBadge statut={imp.statut} map={TON_STATUT} libelles={LIBELLE_STATUT} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
