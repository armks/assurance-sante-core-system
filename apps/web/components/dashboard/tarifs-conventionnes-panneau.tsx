'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { verifierAction, type VerdictsListe } from '@/app/dependances-actions';
import {
  changerTarif,
  creerTarif,
  fermerTarif,
  modifierTarif,
  rouvrirTarif,
  supprimerTarif,
} from '@/app/dashboard-assureur/informatique/reseau-actions';
import {
  ConfirmationAction,
  ChampNombre,
  ChampSelect,
  ChampTexte,
  DataTable,
  FormulaireModal,
  type ColonneTable,
} from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';

export interface TarifConventionne {
  id: string;
  tarifConvention: string | number;
  dateDebut: string;
  dateFin: string | null;
  referentielActe: { code: string; libelle: string; categorie: string | null };
}

export interface ActeDisponible {
  id: string;
  code: string;
  libelle: string;
}

const montant = (v: string | number) => `${Number(v).toLocaleString('fr-FR')} F`;
const dateFr = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR') : '—';

export function TarifsConventionnesPanneau({
  cible,
  cibleId,
  tarifs,
  actesDisponibles,
  verdicts = {},
  peutSupprimer = false,
}: {
  cible: 'etablissement' | 'pharmacie';
  cibleId: string;
  tarifs: TarifConventionne[];
  actesDisponibles: ActeDisponible[];
  /** Verdicts « action possible ? » par tarif (boutons grisés avec la raison). */
  verdicts?: VerdictsListe;
  /** Suppression définitive : service informatique seulement. */
  peutSupprimer?: boolean;
}) {
  const router = useRouter();
  const [voirFermes, setVoirFermes] = useState(false);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const estFerme = (t: TarifConventionne) => !!t.dateFin && t.dateFin.slice(0, 10) < aujourdhui;
  const visibles = voirFermes ? tarifs : tarifs.filter((t) => !estFerme(t));
  const nbFermes = tarifs.length - tarifs.filter((t) => !estFerme(t)).length;

  const colonnes: ColonneTable<TarifConventionne>[] = [
    {
      cle: 'acte',
      entete: 'Acte',
      valeur: (t) => t.referentielActe.libelle,
      rendu: (t) => (
        <span>
          {t.referentielActe.libelle}
          <span className="ml-2 text-xs text-muted-foreground">
            {t.referentielActe.code}
          </span>
        </span>
      ),
    },
    {
      cle: 'tarifConvention',
      entete: 'Tarif conventionné',
      aligneDroite: true,
      valeur: (t) => Number(t.tarifConvention),
      rendu: (t) => montant(t.tarifConvention),
    },
    {
      cle: 'dateDebut',
      entete: 'Depuis le',
      triable: true,
      valeur: (t) => t.dateDebut,
      rendu: (t) => dateFr(t.dateDebut),
    },
    {
      cle: 'dateFin',
      entete: "Jusqu'au",
      rendu: (t) => dateFr(t.dateFin),
    },
  ];

  return (
    <div className="space-y-3">
      {nbFermes > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={voirFermes} onChange={(e) => setVoirFermes(e.target.checked)} />
          Archivés (tarifs fermés : {nbFermes})
        </label>
      )}
    <DataTable
      donnees={visibles}
      cleLigne={(t) => t.id}
      parPage={10}
      colonnes={colonnes}
      actions={
        actesDisponibles.length === 0 ? undefined : (
          <FormulaireModal
            titre="Ajouter un tarif conventionné"
            description="Le montant facturé pour cet acte sera plafonné au tarif EN VIGUEUR À LA DATE DES SOINS. Pour changer de tarif, fixez d'abord la date de fin de l'ancien (la veille), puis ajoutez le nouveau : l'historique est conservé."
            declencheurLabel="Ajouter un tarif"
            libelleSoumettre="Ajouter"
            onSoumettre={async (fd) =>
              creerTarif(cible, cibleId, {
                referentielActeId: String(fd.get('referentielActeId') ?? ''),
                tarifConvention: Number(fd.get('tarifConvention') ?? 0),
                dateDebut: String(fd.get('dateDebut') ?? ''),
                dateFin: String(fd.get('dateFin') ?? '') || undefined,
              })
            }
            onSucces={() => router.refresh()}
          >
            <ChampSelect
              name="referentielActeId"
              label="Acte"
              required
              placeholder="Choisir un acte…"
              options={actesDisponibles.map((a) => ({
                valeur: a.id,
                libelle: `${a.libelle} (${a.code})`,
              }))}
            />
            <ChampNombre
              name="tarifConvention"
              label="Tarif conventionné (FCFA)"
              required
              min={0}
              step="0.01"
            />
            <ChampTexte
              name="dateDebut"
              label="En vigueur depuis le"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
            <ChampTexte
              name="dateFin"
              label="Jusqu'au (optionnel)"
              type="date"
              aide="Laisser vide pour une durée indéterminée."
            />
          </FormulaireModal>
        )
      }
      actionLigne={(t) => {
        const v = verdicts[t.id];
        const ferme = estFerme(t);
        const nom = `le tarif « ${t.referentielActe.libelle} — ${montant(t.tarifConvention)} »`;
        return (
          <span className="flex flex-wrap justify-end gap-2">
            {!ferme && (
              <FormulaireModal
                titre="Changer le tarif à partir du…"
                description={`Acte : ${t.referentielActe.libelle}. L'ancien tarif est fermé la veille de la date choisie et le nouveau prend le relais : l'historique est conservé, chaque soin reste remboursé au tarif en vigueur à sa date.`}
                declencheur={
                  <Button type="button" size="xs" variant="ghost">
                    Changer à partir du…
                  </Button>
                }
                libelleSoumettre="Changer le tarif"
                onSoumettre={async (fd) =>
                  changerTarif(cible, cibleId, t.id, {
                    tarifConvention: Number(fd.get('tarifConvention') ?? 0),
                    aPartirDu: String(fd.get('aPartirDu') ?? ''),
                  })
                }
                onSucces={() => router.refresh()}
              >
                <ChampNombre
                  name="tarifConvention"
                  label="Nouveau tarif conventionné (FCFA)"
                  required
                  min={0}
                  step="0.01"
                  defaultValue={Number(t.tarifConvention)}
                />
                <ChampTexte
                  name="aPartirDu"
                  label="À partir du"
                  type="date"
                  required
                  defaultValue={aujourdhui}
                />
              </FormulaireModal>
            )}
            <FormulaireModal
              titre="Modifier le tarif conventionné"
              description={`Acte : ${t.referentielActe.libelle}.`}
              declencheur={
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={!!v?.modifier && !v.modifier.possible}
                  title={v?.modifier && !v.modifier.possible ? (v.modifier.raison ?? undefined) : undefined}
                >
                  Modifier
                </Button>
              }
              libelleSoumettre="Enregistrer"
              onSoumettre={async (fd) =>
                modifierTarif(cible, cibleId, t.id, {
                  tarifConvention: Number(fd.get('tarifConvention') ?? 0),
                  dateDebut: String(fd.get('dateDebut') ?? ''),
                  dateFin: String(fd.get('dateFin') ?? '') || undefined,
                })
              }
              onSucces={() => router.refresh()}
            >
              <ChampNombre
                name="tarifConvention"
                label="Tarif conventionné (FCFA)"
                required
                min={0}
                step="0.01"
                defaultValue={Number(t.tarifConvention)}
              />
              <ChampTexte
                name="dateDebut"
                label="En vigueur depuis le"
                type="date"
                required
                defaultValue={t.dateDebut.slice(0, 10)}
              />
              <ChampTexte
                name="dateFin"
                label="Jusqu'au (optionnel)"
                type="date"
                defaultValue={t.dateFin?.slice(0, 10)}
              />
            </FormulaireModal>
            {!ferme ? (
              <ConfirmationAction
                action="archiver"
                element={nom}
                consequence="Il est fermé à la date du jour : les soins à venir ne seront plus plafonnés à ce tarif, l'historique est conservé."
                verifier={() => verifierAction('tarif', t.id, 'archiver')}
                onConfirmer={() => fermerTarif(cible, cibleId, t.id)}
                onSucces={() => router.refresh()}
                declencheur={
                  <Button type="button" size="xs" variant="ghost">
                    Fermer
                  </Button>
                }
              />
            ) : (
              <ConfirmationAction
                action="desarchiver"
                element={nom}
                consequence="Il est rouvert (sans date de fin), si aucun tarif suivant n'a pris le relais."
                verifier={() => verifierAction('tarif', t.id, 'desarchiver')}
                onConfirmer={() => rouvrirTarif(cible, cibleId, t.id)}
                onSucces={() => router.refresh()}
                declencheur={
                  <Button type="button" size="xs" variant="ghost">
                    Rouvrir
                  </Button>
                }
              />
            )}
            {peutSupprimer && (
              <ConfirmationAction
                action="supprimer"
                element={nom}
                consequence="Les réclamations déjà adjugées ne sont pas affectées."
                verifier={() => verifierAction('tarif', t.id, 'supprimer')}
                onConfirmer={async () => {
                  const r = await supprimerTarif(cible, cibleId, t.id);
                  return r.ok ? { ok: true } : r;
                }}
                onSucces={() => router.refresh()}
              />
            )}
          </span>
        );
      }}
      vide="Aucun tarif conventionné — le taux de la garantie s'applique au montant facturé."
    />
    </div>
  );
}
