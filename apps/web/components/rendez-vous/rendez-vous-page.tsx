import { redirect } from 'next/navigation';

import { RendezVousEcran, type ModeRendezVous } from '@/components/rendez-vous/rendez-vous-ecran';
import { PageTitre } from '@/components/page-titre';
import { apiFetch, messageErreur } from '@/lib/api';
import { exigerIdentite } from '@/lib/identity';
import type { RendezVous } from '@/lib/rendez-vous';

/** Page (serveur) de la liste des rendez-vous, commune aux établissements, à l'assurance et aux adhérents. */
export async function RendezVousPage({ mode, racine, titre, description }: { mode: ModeRendezVous; racine: string; titre: string; description: string }) {
  const etat = await exigerIdentite(racine);
  if (etat.kind !== 'ok') redirect('/dashboard');
  const res = await apiFetch('/api/v1/rendez-vous');
  const rendezVous: RendezVous[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);
  return (
    <div className="space-y-6">
      <PageTitre titre={titre} description={description} />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <RendezVousEcran rendezVous={rendezVous} mode={mode} racine={racine} role={etat.identity.profil.role ?? undefined} />}
    </div>
  );
}
