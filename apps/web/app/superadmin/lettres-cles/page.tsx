import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import { LettresClesEcran, type LettreCle } from '@/components/superadmin/lettres-cles-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Lettres-clés — Super administration' };

export default async function LettresCles() {
  const res = await apiFetch('/api/v1/superadmin/lettres-cles');
  const lettres: LettreCle[] = res.ok ? await res.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Lettres-clés de la nomenclature"
        description="B, Z, K, D, KA, KC, KE, P, AMI, AMK… Une lettre-clé ne porte aucune valeur en FCFA : les valeurs se négocient établissement par établissement, dans la convention. Une lettre désactivée n’est plus proposée à la cotation des actes."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <LettresClesEcran lettres={lettres} />}
    </div>
  );
}
