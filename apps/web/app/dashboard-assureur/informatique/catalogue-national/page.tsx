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
  title: 'Catalogue national — Assurance Informatique',
};

/** Mise à jour du catalogue national par l'assurance informatique, au même titre que le superadmin (ADR-009). */
export default async function CatalogueNationalInformatique() {
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
        titre="Catalogue national"
        description="Référentiel national des actes et médicaments, partagé par toutes les organisations : ajout, modification de la cotation, homologation, retrait et import Excel. Toute modification est tracée et se répercute sur les éléments activés par les assureurs ; l’activation reste l’affaire de chaque assureur (Référentiel médical)."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <CatalogueNationalEcran actes={actes} medicaments={medicaments} imports={imports} lettresCles={lettresCles} />
      )}
    </div>
  );
}
