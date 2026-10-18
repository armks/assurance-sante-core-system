'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { ajouterRegleAgenda, supprimerRegleAgenda } from '@/app/rendez-vous-actions';
import { ChampSelect, ChampTexte, DataTable, FormulaireModal, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { Button } from '@/components/ui/button';
import { DUREES_CRENEAU, JOURS_SEMAINE, aujourdhui, libelleRegle, type MedecinAgenda, type RegleAgenda } from '@/lib/rendez-vous';

const TYPES = [
  { valeur: 'JOUR', libelle: 'Un jour de la semaine, chaque semaine' },
  { valeur: 'DATE', libelle: 'Une date précise' },
  { valeur: 'ABSENCE', libelle: 'Une absence (date et heures où le médecin n’est pas disponible)' },
];
const LIBELLE_TYPE: Record<string, string> = { JOUR: 'Chaque semaine', DATE: 'Date précise', ABSENCE: 'Absence' };
const TON_TYPE: Record<string, 'info' | 'succes' | 'attention'> = { JOUR: 'info', DATE: 'succes', ABSENCE: 'attention' };

function ChampsRegle({ medecins, moiMedecin }: { medecins: MedecinAgenda[]; moiMedecin: boolean }) {
  const [type, setType] = useState('JOUR');
  return (
    <>
      {!moiMedecin && (
        <ChampSelect name="medecinId" label="Médecin" required placeholder="Choisir le médecin…" defaultValue="" options={medecins.map((m) => ({ valeur: m.id, libelle: m.nom }))} />
      )}
      <ChampSelect name="type" label="Type de disponibilité" value={type} onChange={(e) => setType(e.target.value)} options={TYPES} />
      {type === 'JOUR' && (
        <>
          <ChampSelect name="jourSemaine" label="Jour de la semaine" required defaultValue="1" options={JOURS_SEMAINE} />
          <div className="grid grid-cols-2 gap-3">
            <ChampTexte name="valideDu" label="Valable du" type="date" aide="Facultatif" />
            <ChampTexte name="valideAu" label="Jusqu’au" type="date" aide="Facultatif" />
          </div>
        </>
      )}
      {type !== 'JOUR' && <ChampTexte name="date" label="Date" type="date" required min={aujourdhui()} />}
      <div className="grid grid-cols-2 gap-3">
        <ChampTexte name="heureDebut" label={type === 'ABSENCE' ? 'De' : 'Présent de'} type="time" required defaultValue="08:00" />
        <ChampTexte name="heureFin" label={type === 'ABSENCE' ? 'À' : 'Jusqu’à'} type="time" required defaultValue="12:00" />
      </div>
      {type !== 'ABSENCE' && (
        <ChampSelect
          name="dureeCreneauMin"
          label="Intervalle entre deux rendez-vous"
          required
          defaultValue="30"
          options={DUREES_CRENEAU.map((d) => ({ valeur: String(d), libelle: d >= 60 && d % 60 === 0 ? `${d / 60} h` : `${d} minutes` }))}
          aide="Durée de chaque créneau proposé aux patients."
        />
      )}
    </>
  );
}

/**
 * Agenda de présence des médecins : règles par jour de la semaine, par date précise, ou absences, avec heures et intervalle entre deux
 * rendez-vous. L'accueil règle l'agenda de tous les médecins de l'établissement ; un médecin règle le sien.
 */
export function AgendaPresenceEcran({ regles, medecins, moiMedecin, racine }: { regles: RegleAgenda[]; medecins: MedecinAgenda[]; moiMedecin: boolean; racine: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtreMedecin, setFiltreMedecin] = useState('');
  const visibles = useMemo(() => (filtreMedecin ? regles.filter((r) => r.medecinId === filtreMedecin) : regles), [regles, filtreMedecin]);

  const colonnes: ColonneTable<RegleAgenda>[] = [
    ...(moiMedecin ? [] : [{ cle: 'medecin', entete: 'Médecin', triable: true } satisfies ColonneTable<RegleAgenda>]),
    { cle: 'type', entete: 'Type', rendu: (r) => <StatutBadge statut={r.type} ton={TON_TYPE[r.type]} libelle={LIBELLE_TYPE[r.type]} /> },
    { cle: 'detail', entete: 'Disponibilité', valeur: (r) => libelleRegle(r), rendu: (r) => libelleRegle(r) },
  ];

  return (
    <div className="space-y-4">
      {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{erreur}</p>}
      {!moiMedecin && (
        <label className="block max-w-sm space-y-1 text-sm font-medium">
          Afficher l’agenda de
          <select value={filtreMedecin} onChange={(e) => setFiltreMedecin(e.target.value)} className="block h-9 w-full rounded-md border bg-background px-3 text-sm font-normal">
            <option value="">Tous les médecins</option>
            {medecins.map((m) => (
              <option key={m.id} value={m.id}>{m.nom}</option>
            ))}
          </select>
        </label>
      )}
      <DataTable
        donnees={visibles}
        cleLigne={(r) => r.id}
        parPage={20}
        colonnes={colonnes}
        vide="Aucune disponibilité renseignée : les rendez-vous ne peuvent pas être proposés tant que l’agenda est vide."
        actions={
          <FormulaireModal
            titre="Ajouter une disponibilité"
            description="Les créneaux sont générés à partir des heures de présence et de l’intervalle choisi. Une règle « date précise » remplace la règle hebdomadaire ce jour-là."
            declencheurLabel="Ajouter une disponibilité"
            libelleSoumettre="Enregistrer"
            onSoumettre={async (fd) => {
              const num = (k: string) => (fd.get(k) ? Number(fd.get(k)) : undefined);
              const texte = (k: string) => (String(fd.get(k) ?? '') || undefined);
              return ajouterRegleAgenda(
                {
                  medecinId: texte('medecinId'),
                  type: String(fd.get('type') ?? 'JOUR') as 'JOUR' | 'DATE' | 'ABSENCE',
                  jourSemaine: num('jourSemaine'),
                  date: texte('date'),
                  valideDu: texte('valideDu'),
                  valideAu: texte('valideAu'),
                  heureDebut: String(fd.get('heureDebut') ?? ''),
                  heureFin: String(fd.get('heureFin') ?? ''),
                  dureeCreneauMin: num('dureeCreneauMin'),
                },
                racine,
              );
            }}
            onSucces={() => router.refresh()}
          >
            <ChampsRegle medecins={medecins} moiMedecin={moiMedecin} />
          </FormulaireModal>
        }
        actionLigne={(r) => (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Supprimer cette disponibilité ?\n${libelleRegle(r)}\nLes rendez-vous déjà pris ne sont pas annulés.`)) return;
              setErreur(null);
              start(async () => {
                const res = await supprimerRegleAgenda(r.id, racine);
                if (res.ok) router.refresh();
                else setErreur(res.error);
              });
            }}
          >
            Supprimer
          </Button>
        )}
      />
    </div>
  );
}
