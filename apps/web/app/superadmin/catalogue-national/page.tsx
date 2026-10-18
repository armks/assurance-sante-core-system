import type { Metadata } from 'next';

import type { ImportCatalogueResume } from '@/app/superadmin/catalogue-national/actions';
import { BoutonNomenclature } from '@/components/documents/bouton-nomenclature';
import type { PageServeur } from '@/components/dashboard/patterns';
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

export default async function CatalogueNational({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const un = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? '';
  const qs = new URLSearchParams({ page: un('page') || '1', limite: '25' });
  if (un('q')) qs.set('q', un('q'));
  if (un('statut')) qs.set('statut', un('statut'));
  const [resActes, resMed, resImports, resLettres, resArchives] = await Promise.all([
    apiFetch(`/api/v1/superadmin/catalogue-national/actes?${qs.toString()}`),
    apiFetch('/api/v1/superadmin/catalogue-national/medicaments'),
    apiFetch('/api/v1/superadmin/catalogue-national/imports'),
    apiFetch('/api/v1/superadmin/lettres-cles'),
    apiFetch('/api/v1/superadmin/catalogue-national/actes?statut=RETIRE&page=1&limite=1'),
  ]);
  const lettresCles: LettreCleOption[] = resLettres.ok ? await resLettres.json() : [];
  const pageActes: PageServeur<ActeNational> = resActes.ok
    ? await resActes.json()
    : { items: [], total: 0, page: 1, limite: 25, pages: 1 };
  const nbArchivesActes: number = resArchives.ok ? ((await resArchives.json()) as PageServeur<ActeNational>).total : 0;
  const medicaments: MedicamentNational[] = resMed.ok ? await resMed.json() : [];
  const imports: ImportCatalogueResume[] = resImports.ok ? await resImports.json() : [];
  const erreur = resActes.ok ? null : await messageErreur(resActes);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Catalogue national partagé"
        description="Référentiel national des actes et médicaments (v1 §10.4). Une organisation l’importe vers son propre référentiel au statut PROPOSÉ ; l’homologation reste du ressort de ses médecin-conseil / pharmacien-conseil."
        action={<BoutonNomenclature />}
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <CatalogueNationalEcran pageActes={pageActes} nbArchivesActes={nbArchivesActes} medicaments={medicaments} imports={imports} lettresCles={lettresCles} />
      )}
    </div>
  );
}
