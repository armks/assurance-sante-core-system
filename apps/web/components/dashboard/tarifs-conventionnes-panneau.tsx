'use client';

import { useRouter } from 'next/navigation';

import {
  creerTarif,
  modifierTarif,
  supprimerTarif,
} from '@/app/dashboard-assureur/informatique/reseau-actions';
import {
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
}: {
  cible: 'etablissement' | 'pharmacie';
  cibleId: string;
  tarifs: TarifConventionne[];
  actesDisponibles: ActeDisponible[];
}) {
  const router = useRouter();

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
    <DataTable
      donnees={tarifs}
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
      actionLigne={(t) => (
        <span className="flex justify-end gap-2">
          <FormulaireModal
            titre="Modifier le tarif conventionné"
            description={`Acte : ${t.referentielActe.libelle}.`}
            declencheur={
              <Button type="button" size="xs" variant="ghost">
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
          <FormulaireModal
            titre="Supprimer le tarif conventionné"
            mode="center"
            declencheur={
              <Button type="button" size="xs" variant="ghost">
                Supprimer
              </Button>
            }
            libelleSoumettre="Supprimer"
            onSoumettre={async () => {
              const r = await supprimerTarif(cible, cibleId, t.id);
              return r.ok
                ? { ok: true, message: 'Tarif supprimé.' }
                : { ok: false, error: r.error };
            }}
            onSucces={() => router.refresh()}
          >
            <p className="text-sm text-muted-foreground">
              Le tarif conventionné pour « {t.referentielActe.libelle} » sera
              retiré. Les réclamations déjà adjugées ne sont pas affectées.
            </p>
          </FormulaireModal>
        </span>
      )}
      vide="Aucun tarif conventionné — le taux de la garantie s'applique au montant facturé."
    />
  );
}
