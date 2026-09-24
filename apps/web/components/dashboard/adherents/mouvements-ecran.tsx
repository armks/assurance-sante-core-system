'use client';

import { useRouter } from 'next/navigation';

import { proposerAdherent } from '@/app/dashboard-societe/propositions-actions';
import {
  importerEntrantsExcel,
  importerSortantsExcel,
  proposerSortants,
} from '@/app/dashboard-societe/mouvements-actions';
import {
  ChampFichier,
  ChampSelect,
  ChampTexte,
  ChampZone,
  DataTable,
  FormulaireModal,
  StatutBadge,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LIBELLE_STATUT_MEMBRE,
  STATUTS_SORTANT_CIBLE,
  TON_STATUT_MEMBRE,
  peutProposerMembres,
  peutProposerSortants,
} from '@/lib/member';
import type { AdherentListe, ImportAdherentsResume } from './types';

const LIBELLE_STATUT_IMPORT: Record<string, string> = {
  EN_ATTENTE_VALIDATION: 'En attente de validation',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
};
const TON_STATUT_IMPORT: Record<string, 'succes' | 'attention' | 'danger'> = {
  EN_ATTENTE_VALIDATION: 'attention',
  VALIDE: 'succes',
  REJETE: 'danger',
};

const dateFr = (d: string) => new Date(d).toLocaleDateString('fr-FR');
const moisFr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/**
 * "YYYY-MM" (input type=month) → "YYYY-MM-01", tel qu'attendu par l'API.
 * Vide = mois calendaire suivant — calculé ICI (pas côté API : `proposerAdherent`
 * reste neutre par défaut pour ne pas changer le comportement des propositions
 * générales déjà construites, hors contexte mouvements de personnel) pour que
 * « pas immédiat » soit bien le comportement réellement vécu par défaut sur
 * cet écran, comme l'import Excel d'entrants (toujours différé, lui, côté API).
 */
function moisEffetVersISO(valeurMois: string): string {
  if (valeurMois) return `${valeurMois}-01`;
  const maintenant = new Date();
  const suivant = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 1));
  return suivant.toISOString().slice(0, 10);
}

/**
 * Écran société « Gérer les entrants/sortants » — mouvements de personnel :
 * sortants (effet immédiat après validation assureur) et entrants (effet
 * différé au 1er du mois suivant, cohérent avec la coupure de facturation
 * déjà posée). Statuts visibles jusqu'à validation dans les deux flux.
 */
export function MouvementsEcran({
  souscripteurId,
  adherents,
  roleChain,
  imports,
}: {
  souscripteurId: string;
  adherents: AdherentListe[];
  roleChain: string[];
  imports: ImportAdherentsResume[];
}) {
  const router = useRouter();
  const peutSortants = peutProposerSortants(roleChain);
  const peutEntrants = peutProposerMembres(roleChain);

  const actifs = adherents.filter((a) => a.statut === 'ACTIF');
  const enAttenteSortie = adherents.filter((a) => a.statut === 'PROPOSE_SORTANT');

  const colonnesActifs: ColonneTable<AdherentListe>[] = [
    {
      cle: 'nom',
      entete: 'Nom / prénom',
      valeur: (a) => `${a.nom} ${a.prenom}`,
      rendu: (a) => `${a.nom} ${a.prenom}`,
    },
    { cle: 'numeroAdherent', entete: 'N° adhérent' },
  ];

  return (
    <div className="space-y-8">
      {/* --- Sortants ------------------------------------------------ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Sortants</CardTitle>
          {peutSortants && (
            <FormulaireModal
              titre="Importer un fichier de sortants"
              description="Colonnes attendues : identifiant (n° adhérent ou e-mail), motif, statut cible (optionnel — SUSPENDU ou RADIE, défaut RADIE)."
              declencheurLabel="Importer un fichier"
              libelleSoumettre="Importer le fichier"
              onSoumettre={async (fd) => {
                const r = await importerSortantsExcel(souscripteurId, fd);
                if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
                return {
                  ok: true,
                  message: `${r.nbProposes} sortie(s) proposée(s) — ${r.erreursDetail.length} ligne(s) en erreur.`,
                };
              }}
              onSucces={() => router.refresh()}
            >
              <ChampFichier
                name="fichier"
                label="Fichier Excel (.xlsx)"
                required
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              />
            </FormulaireModal>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {enAttenteSortie.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                En attente de validation assureur ({enAttenteSortie.length})
              </p>
              {enAttenteSortie.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <span className="font-medium">{a.nom} {a.prenom}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      → {a.statutSortantCible === 'SUSPENDU' ? 'Suspendre' : 'Radier'} · {a.motifSortie}
                    </span>
                  </div>
                  <StatutBadge statut={a.statut} map={TON_STATUT_MEMBRE} libelles={LIBELLE_STATUT_MEMBRE} />
                </div>
              ))}
            </div>
          )}

          {peutSortants ? (
            <DataTable
              donnees={actifs}
              cleLigne={(a) => a.id}
              parPage={10}
              recherche={{ placeholder: 'Nom, prénom, n° adhérent…', champs: ['nom', 'prenom', 'numeroAdherent'] }}
              colonnes={colonnesActifs}
              actionLigne={(a) => (
                <FormulaireModal
                  titre={`Proposer la sortie de ${a.nom} ${a.prenom}`}
                  description="Effective seulement après validation par l'assureur."
                  declencheur={<Button type="button" size="xs" variant="outline">Proposer la sortie</Button>}
                  libelleSoumettre="Proposer"
                  onSoumettre={async (fd) => {
                    const r = await proposerSortants(souscripteurId, [
                      {
                        adherentId: a.id,
                        statutCible: String(fd.get('statutCible') ?? ''),
                        motif: String(fd.get('motif') ?? ''),
                      },
                    ]);
                    if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
                    return { ok: true, message: 'Sortie proposée — en attente de validation.' };
                  }}
                  onSucces={() => router.refresh()}
                >
                  <ChampSelect name="statutCible" label="Action" required placeholder="Choisir…" options={STATUTS_SORTANT_CIBLE} />
                  <ChampZone name="motif" label="Motif" required aide="Tracé dans l'audit." />
                </FormulaireModal>
              )}
              vide="Aucun adhérent actif."
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Seul SOCIETE_ADMINISTRATION peut proposer un mouvement de sortie.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- Entrants (effet différé) ---------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <CardTitle className="text-base">Entrants — effet différé au mois suivant</CardTitle>
          {peutEntrants && (
            <div className="flex flex-wrap gap-2">
              <FormulaireModal
                titre="Proposer un entrant"
                description="Prend effet au mois indiqué (par défaut : le mois suivant) — cohérent avec la coupure de facturation."
                declencheurLabel="Proposer un entrant"
                libelleSoumettre="Proposer"
                onSoumettre={async (fd) => {
                  const r = await proposerAdherent(souscripteurId, {
                    nom: String(fd.get('nom') ?? ''),
                    prenom: String(fd.get('prenom') ?? ''),
                    telephone: String(fd.get('telephone') ?? ''),
                    email: String(fd.get('email') ?? ''),
                    dateNaissance: String(fd.get('dateNaissance') ?? ''),
                    moisEffet: moisEffetVersISO(String(fd.get('moisEffet') ?? '')),
                  });
                  if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
                  return { ok: true, message: 'Entrant proposé — en attente de validation.' };
                }}
                onSucces={() => router.refresh()}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <ChampTexte name="nom" label="Nom" required maxLength={120} />
                  <ChampTexte name="prenom" label="Prénom" required maxLength={120} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ChampTexte name="telephone" label="Téléphone" required maxLength={20} />
                  <ChampTexte name="email" label="E-mail" type="email" required maxLength={200} />
                </div>
                <ChampTexte name="dateNaissance" label="Date de naissance" type="date" required />
                <ChampTexte
                  name="moisEffet"
                  label="Mois d'effet"
                  type="month"
                  aide="Laisser vide pour le mois suivant (par défaut)."
                />
              </FormulaireModal>

              <FormulaireModal
                titre="Importer un fichier d'entrants"
                description="Colonnes attendues : nom, prénom, téléphone, email, date de naissance."
                declencheur={<Button type="button" variant="outline">Importer un fichier</Button>}
                libelleSoumettre="Importer le fichier"
                onSoumettre={async (fd) => {
                  const fichier = fd.get('fichier');
                  const moisEffet = moisEffetVersISO(String(fd.get('moisEffet') ?? ''));
                  const donnees = new FormData();
                  if (fichier) donnees.set('fichier', fichier);
                  if (moisEffet) donnees.set('moisEffet', moisEffet);
                  const r = await importerEntrantsExcel(souscripteurId, donnees);
                  if (!r.ok) return { ok: false, error: r.error, erreurs: r.erreurs };
                  return {
                    ok: true,
                    message: `${r.import.nbLignesValides} entrant(s) proposé(s) — ${r.import.nbLignesErreur} ligne(s) en erreur.`,
                  };
                }}
                onSucces={() => router.refresh()}
              >
                <ChampFichier
                  name="fichier"
                  label="Fichier Excel (.xlsx)"
                  required
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
                <ChampTexte
                  name="moisEffet"
                  label="Mois d'effet"
                  type="month"
                  aide="Laisser vide pour le mois suivant (par défaut)."
                />
              </FormulaireModal>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {imports.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun mouvement d’entrant en cours.</p>
          )}
          {imports.map((imp) => (
            <div key={imp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  {imp.nbLignesValides} entrant(s) — effet {imp.moisEffet ? moisFr(imp.moisEffet) : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Proposé le {dateFr(imp.createdAt)} · {imp.nbLignesErreur} ligne(s) en erreur
                </p>
              </div>
              <StatutBadge statut={imp.statut} map={TON_STATUT_IMPORT} libelles={LIBELLE_STATUT_IMPORT} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
