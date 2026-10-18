import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AgendaPresenceEcran } from '@/components/rendez-vous/agenda-presence-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import type { MedecinAgenda, RegleAgenda } from '@/lib/rendez-vous';

export const metadata: Metadata = { title: 'Agenda de présence — Établissement' };

const RACINE = '/dashboard-centre-medical/agenda';

export default async function AgendaPage() {
  const etat = await exigerIdentite(RACINE);
  if (etat.kind !== 'ok') redirect('/dashboard');
  const role = etat.identity.profil.role;
  const autorise = role === 'CENTRE_MEDICAL_ACCUEIL' || role === 'CENTRE_MEDICAL_MEDECIN';
  const [resAgenda, resMedecins] = autorise ? await Promise.all([apiFetch('/api/v1/rendez-vous/agenda'), apiFetch('/api/v1/rendez-vous/medecins')]) : [null, null];
  const regles: RegleAgenda[] = resAgenda?.ok ? await resAgenda.json() : [];
  const medecins: MedecinAgenda[] = resMedecins?.ok ? await resMedecins.json() : [];
  const erreur = !autorise ? 'L’agenda de présence est réservé à l’accueil et aux médecins de l’établissement.' : resAgenda && !resAgenda.ok ? await messageErreur(resAgenda) : null;
  return (
    <div className="space-y-6">
      <PageTitre
        titre="Agenda de présence des médecins"
        description="Renseignez quand chaque médecin est présent — par jour de la semaine, par date précise, avec les heures et l’intervalle entre deux rendez-vous. L’assurance ne peut proposer un rendez-vous que sur ces créneaux."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <AgendaPresenceEcran regles={regles} medecins={medecins} moiMedecin={role === 'CENTRE_MEDICAL_MEDECIN'} racine={RACINE} />}
    </div>
  );
}
