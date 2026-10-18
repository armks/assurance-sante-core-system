import { PageTitre } from '@/components/page-titre';
import { ParametresImpressionEcran } from '@/components/impression/parametres-impression-ecran';
import type { ParametresImpression } from '@/app/parametres-impression-types';
import { apiFetch, messageErreur } from '@/lib/api';

/** Page (serveur) de paramétrage de l'imprimante des reçus ; réservée à la caisse d'un établissement ou d'une pharmacie. */
export async function ParametresImpressionPage({ racine, lieu }: { racine: string; lieu: string }) {
  const res = await apiFetch('/api/v1/recus/parametres');
  const parametres = res.ok ? ((await res.json()) as ParametresImpression) : null;
  const erreur = res.ok ? null : await messageErreur(res);
  return (
    <div className="space-y-6">
      <PageTitre
        titre="Impression des reçus"
        description={`Choisissez l’imprimante de caisse de ${lieu} (ticket thermique 58 ou 80 mm, ou A4) et personnalisez le reçu remis au patient lorsqu’il règle sa facture.`}
      />
      {erreur || !parametres ? <p className="text-sm text-destructive">{erreur ?? 'Paramètres indisponibles.'}</p> : <ParametresImpressionEcran parametres={parametres} racine={racine} />}
    </div>
  );
}
