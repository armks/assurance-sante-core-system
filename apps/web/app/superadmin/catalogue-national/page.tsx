import type { Metadata } from 'next';

import type { ImportCatalogueResume } from '@/app/superadmin/catalogue-national/actions';
import { PageTitre } from '@/components/page-titre';
import {
  CatalogueNationalEcran,
  type ActeNational,
  type LettreCleOption,
  type MedicamentNational,
} from '@/components/superadmin/catalogue-national-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Catalogue national — Super administration',
};

export default async function CatalogueNational() {
  const [resActes, resMed, resImports, resLettres] = await Promise.all([
    apiFetch('/api/v1/superadmin/catalogue-national/actes'),
    apiFetch('/api/v1/superadmin/catalogue-national/medicaments'),
    apiFetch('/api/v1/superadmin/catalogue-national/imports'),
    apiFetch('/api/v1/superadmin/lettres-cles'),
  ]);
  const lettresCles: LettreCleOption[] = resLettres.ok ? await resLettres.json() : [];
  const actes: ActeNational[] = resActes.ok ? await resActes.json() : [];
  const medicaments: MedicamentNational[] = resMed.ok ? await resMed.json() : [];
  const imports: ImportCatalogueResume[] = resImports.ok ? await resImports.json() : [];
  const erreur = resActes.ok ? null : await messageErreur(resActes);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Catalogue national partagé"
        description="Référentiel national des actes et médicaments (v1 §10.4). Une organisation l’importe vers son propre référentiel au statut PROPOSÉ ; l’homologation reste du ressort de ses médecin-conseil / pharmacien-conseil."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <CatalogueNationalEcran actes={actes} medicaments={medicaments} imports={imports} lettresCles={lettresCles} />
      )}
    </div>
  );
}
