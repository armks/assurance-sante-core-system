'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus } from 'lucide-react';

import {
  annulerRendezVous,
  chargerMedecins,
  confirmerRendezVous,
  modifierRendezVous,
  refuserRendezVous,
} from '@/app/rendez-vous-actions';
import { ChampSelect, ChampTexte, DataTable, FormulaireModal, GrilleCartes, CarteResume, StatutBadge, type ColonneTable } from '@/components/dashboard/patterns';
import { ProposerRendezVous } from '@/components/rendez-vous/proposer-rendez-vous';
import { SelecteurCreneau } from '@/components/rendez-vous/selecteur-creneau';
import { Button } from '@/components/ui/button';
import { LIBELLE_LIEN, LIBELLE_STATUT_RDV, dateHeureRdv, type MedecinAgenda, type RendezVous } from '@/lib/rendez-vous';

export type ModeRendezVous = 'etablissement' | 'assurance' | 'adherent';

const TON: Record<string, 'attention' | 'succes' | 'danger' | 'neutre'> = { PROPOSE: 'attention', CONFIRME: 'succes', REFUSE: 'danger', ANNULE: 'neutre' };

/** Fenêtre « Modifier » : nouveau créneau (et, pour l'accueil, autre médecin) ; le rendez-vous est alors confirmé au nouveau créneau. */
function ModifierRendezVous({ rdv, peutChangerMedecin, racine }: { rdv: RendezVous; peutChangerMedecin: boolean; racine: string }) {
  const router = useRouter();
  const [medecins, setMedecins] = useState<MedecinAgenda[]>([]);
  const [medecinId, setMedecinId] = useState(rdv.medecin.id);
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    if (ouvert && peutChangerMedecin) void chargerMedecins().then((r) => r.ok && setMedecins(r.data));
  }, [ouvert, peutChangerMedecin]);

  return (
    <FormulaireModal
      titre="Modifier le rendez-vous"
      description={`${rdv.patient.nom} — actuellement le ${dateHeureRdv(rdv.dateDebut)} avec ${rdv.medecin.nom}. Le rendez-vous sera confirmé au nouveau créneau.`}
      ouvert={ouvert}
      onOuvertChange={setOuvert}
      declencheur={<Button type="button" size="xs" variant="outline">Modifier</Button>}
      libelleSoumettre="Confirmer le nouveau créneau"
      onSoumettre={async (fd) => {
        const debut = String(fd.get('debut') ?? '');
        if (!debut) return { ok: false, error: 'Choisissez un nouveau créneau.' };
        return modifierRendezVous(rdv.id, { debut, medecinId: medecinId !== rdv.medecin.id ? medecinId : undefined }, racine);
      }}
      onSucces={() => router.refresh()}
    >
      {peutChangerMedecin && (
        <ChampSelect
          name="medecinChoisi"
          label="Médecin"
          value={medecinId}
          onChange={(e) => setMedecinId(e.target.value)}
          options={medecins.length ? medecins.map((m) => ({ valeur: m.id, libelle: m.nom })) : [{ valeur: rdv.medecin.id, libelle: rdv.medecin.nom }]}
        />
      )}
      <SelecteurCreneau medecinId={medecinId} sauf={rdv.id} />
    </FormulaireModal>
  );
}

function ActionAvecMotif({ titre, libelle, description, onValider, racine }: { titre: string; libelle: string; description: string; onValider: (motif: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string; erreurs?: string[] }>; racine: string }) {
  const router = useRouter();
  void racine;
  return (
    <FormulaireModal
      titre={titre}
      description={description}
      mode="center"
      declencheur={<Button type="button" size="xs" variant="ghost">{libelle}</Button>}
      libelleSoumettre={libelle}
      onSoumettre={(fd) => onValider(String(fd.get('motif') ?? ''))}
      onSucces={() => router.refresh()}
    >
      <ChampTexte name="motif" label="Motif" required minLength={3} maxLength={300} />
    </FormulaireModal>
  );
}

/**
 * Liste des rendez-vous, selon le profil :
 * - établissement (accueil / médecin concerné) : reçoit les propositions → confirmer, modifier, refuser ;
 * - assurance (secrétaire, exploitation) : propose, suit et annule ;
 * - adhérent : consulte seulement, avec le lien d'enregistrement dans Google Agenda.
 */
export function RendezVousEcran({ rendezVous, mode, racine, role }: { rendezVous: RendezVous[]; mode: ModeRendezVous; racine: string; role?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const aTraiter = rendezVous.filter((r) => r.statut === 'PROPOSE').length;
  const aVenir = rendezVous.filter((r) => r.statut === 'CONFIRME' && new Date(r.dateFin) > new Date()).length;

  const colonnes: ColonneTable<RendezVous>[] = [
    { cle: 'dateDebut', entete: 'Date et heure', triable: true, valeur: (r) => r.dateDebut, rendu: (r) => (
      <span>
        {dateHeureRdv(r.dateDebut)}
        {r.modifie && r.ancienneDateDebut && <span className="block text-xs text-muted-foreground">modifié (avant : {dateHeureRdv(r.ancienneDateDebut)})</span>}
      </span>
    ) },
    { cle: 'patient', entete: 'Patient', valeur: (r) => r.patient.nom, rendu: (r) => (
      <span>
        {r.patient.nom}
        <span className="block text-xs text-muted-foreground">{LIBELLE_LIEN[r.patient.lien] ?? r.patient.lien}{r.patient.numeroCarte ? ` — ${r.patient.numeroCarte}` : ''}</span>
      </span>
    ) },
    { cle: 'medecin', entete: 'Médecin', valeur: (r) => r.medecin.nom, rendu: (r) => r.medecin.nom },
    ...(mode === 'etablissement' ? [] : [{ cle: 'etablissement', entete: 'Établissement', valeur: (r: RendezVous) => r.etablissement.nom, rendu: (r: RendezVous) => (
      <span>
        {r.etablissement.nom}
        {r.etablissement.adresse && <span className="block text-xs text-muted-foreground">{r.etablissement.adresse}</span>}
      </span>
    ) } satisfies ColonneTable<RendezVous>]),
    { cle: 'motif', entete: 'Motif', rendu: (r) => r.motif ?? '—' },
    ...(mode === 'adherent' ? [] : [{ cle: 'proposePar', entete: 'Proposé par', rendu: (r: RendezVous) => r.proposePar ?? '—' } satisfies ColonneTable<RendezVous>]),
    { cle: 'statut', entete: 'Statut', rendu: (r) => (
      <span>
        <StatutBadge statut={r.statut} ton={TON[r.statut]} libelle={LIBELLE_STATUT_RDV[r.statut]} />
        {(r.statut === 'REFUSE' || r.statut === 'ANNULE') && r.motifRefus && <span className="mt-0.5 block text-xs text-muted-foreground">{r.motifRefus}</span>}
      </span>
    ) },
  ];

  const agir = (f: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      setErreur(null);
      const r = await f();
      if (r.ok) router.refresh();
      else setErreur(r.error);
    });

  const lienAgenda = (r: RendezVous) =>
    r.lienGoogleAgenda ? (
      <Button asChild size="xs" variant="outline">
        <a href={r.lienGoogleAgenda} target="_blank" rel="noopener noreferrer">
          <CalendarPlus className="size-3.5" aria-hidden="true" /> Google Agenda
        </a>
      </Button>
    ) : null;

  return (
    <div className="space-y-4">
      {mode !== 'adherent' && (
        <GrilleCartes>
          <CarteResume libelle={mode === 'etablissement' ? 'Propositions à traiter' : 'Propositions en attente'} valeur={aTraiter} />
          <CarteResume libelle="Rendez-vous confirmés à venir" valeur={aVenir} />
        </GrilleCartes>
      )}
      {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{erreur}</p>}
      <DataTable
        donnees={rendezVous}
        cleLigne={(r) => r.id}
        parPage={15}
        colonnes={colonnes}
        recherche={{ placeholder: 'Patient, médecin, établissement…', champs: ['patient.nom', 'medecin.nom', 'etablissement.nom', 'patient.numeroCarte'] }}
        filtres={[{ cle: 'statut', libelle: 'Statut', options: Object.entries(LIBELLE_STATUT_RDV).map(([valeur, libelle]) => ({ valeur, libelle })) }]}
        vide={mode === 'adherent' ? 'Aucun rendez-vous. Pour en demander un, écrivez à la secrétaire de l’assurance par la messagerie (bulle en bas à droite).' : 'Aucun rendez-vous.'}
        actions={mode === 'assurance' ? <ProposerRendezVous racine={racine} /> : undefined}
        actionLigne={(r) => {
          if (mode === 'adherent') return lienAgenda(r);
          if (mode === 'assurance') {
            return (
              <div className="flex items-center justify-end gap-1">
                {lienAgenda(r)}
                {['PROPOSE', 'CONFIRME'].includes(r.statut) && (
                  <ActionAvecMotif titre="Annuler le rendez-vous" libelle="Annuler" description={`${r.patient.nom} — ${dateHeureRdv(r.dateDebut)} avec ${r.medecin.nom}.`} racine={racine} onValider={(m) => annulerRendezVous(r.id, m, racine)} />
                )}
              </div>
            );
          }
          return (
            <div className="flex flex-wrap items-center justify-end gap-1">
              {r.statut === 'PROPOSE' && (
                <>
                  <Button type="button" size="xs" disabled={pending} onClick={() => agir(() => confirmerRendezVous(r.id, racine))}>Confirmer</Button>
                  <ActionAvecMotif titre="Refuser la proposition" libelle="Refuser" description={`${r.patient.nom} — ${dateHeureRdv(r.dateDebut)}. L’assurance verra le motif.`} racine={racine} onValider={(m) => refuserRendezVous(r.id, m, racine)} />
                </>
              )}
              {['PROPOSE', 'CONFIRME'].includes(r.statut) && <ModifierRendezVous rdv={r} peutChangerMedecin={role === 'CENTRE_MEDICAL_ACCUEIL'} racine={racine} />}
              {r.statut === 'CONFIRME' && (
                <ActionAvecMotif titre="Annuler le rendez-vous" libelle="Annuler" description={`${r.patient.nom} — ${dateHeureRdv(r.dateDebut)}.`} racine={racine} onValider={(m) => annulerRendezVous(r.id, m, racine)} />
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
