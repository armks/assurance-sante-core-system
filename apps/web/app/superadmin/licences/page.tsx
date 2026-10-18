import type { Metadata } from 'next';

import { PageTitre } from '@/components/page-titre';
import { LicencesEcran, type LicenceSociete, type TypeLicenceOption } from '@/components/superadmin/licences-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = { title: 'Licences — Superadmin' };

export default async function LicencesSuperadminPage() {
  const [res, resTypes] = await Promise.all([apiFetch('/api/v1/superadmin/licences'), apiFetch('/api/v1/superadmin/licences/types')]);
  const licences: LicenceSociete[] = res.ok ? await res.json() : [];
  const types: TypeLicenceOption[] = resTypes.ok ? await resTypes.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-6">
      <PageTitre
        titre="Licences des sociétés d’assurance"
        description="Activez une société directement, ou générez un code d’activation temporaire (24 h) reçu par e-mail et à transmettre à son administrateur. Vous pouvez aussi envoyer une alerte d’expiration."
      />
      {erreur ? <p className="text-sm text-destructive">{erreur}</p> : <LicencesEcran licences={licences} types={types} />}
    </div>
  );
}
