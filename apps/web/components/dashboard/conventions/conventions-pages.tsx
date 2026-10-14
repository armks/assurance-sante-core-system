import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { ConventionDetailEcran } from '@/components/dashboard/conventions/convention-detail';
import { ConventionsEcran } from '@/components/dashboard/conventions/conventions-ecran';
import { PageTitre } from '@/components/page-titre';
import { Button } from '@/components/ui/button';
import { apiFetch, messageErreur } from '@/lib/api';
import type {
  ConventionDetail,
  ConventionResume,
  IndicateursConventions,
  LettreCleActive,
} from '@/lib/conventions';
import { exigerIdentite } from '@/lib/identity';

const SAISIE = ['ASSUREUR_INFORMATIQUE'];
const VALIDATION = ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'];

async function droits(base: string) {
  const etat = await exigerIdentite(`${base}/conventions`);
  if (etat.kind !== 'ok') redirect('/dashboard');
  const roles = etat.identity.permissions?.roleChain ?? [];
  return {
    peutSaisir: roles.some((r) => SAISIE.includes(r)),
    peutValider: roles.some((r) => VALIDATION.includes(r)),
  };
}

/** Page « Conventions » d'un espace (`base` = /dashboard-assureur/informatique | medecin-conseil | direction). */
export async function PageConventions({ base }: { base: string }) {
  const { peutSaisir } = await droits(base);
  const [res, resInd, resEtab] = await Promise.all([
    apiFetch('/api/v1/conventions'),
    apiFetch('/api/v1/conventions/indicateurs'),
    peutSaisir ? apiFetch('/api/v1/provider/etablissements') : Promise.resolve(null),
  ]);
  const conventions: ConventionResume[] = res.ok ? await res.json() : [];
  const indicateurs: IndicateursConventions | null = resInd.ok ? await resInd.json() : null;
  const etablissements: { id: string; nom: string; code: string; statut: string }[] =
    resEtab && resEtab.ok ? await resEtab.json() : [];
  const erreur = res.ok ? null : await messageErreur(res);

  return (
    <div className="space-y-8">
      <PageTitre
        titre="Conventions des établissements"
        description="Valeurs négociées par établissement : saisie par l’assurance informatique, validation par le médecin conseil ou la direction (jamais par la personne qui a saisi). Une convention validée ne se modifie plus : on crée une nouvelle version."
      />
      {erreur ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : (
        <ConventionsEcran
          conventions={conventions}
          etablissements={etablissements.filter((e) => e.statut !== 'RESILIE')}
          indicateurs={indicateurs}
          base={base}
          peutSaisir={peutSaisir}
        />
      )}
    </div>
  );
}

/** Page détail d'une convention : formulaire unique, circuit, document. */
export async function PageConventionDetail({ base, id }: { base: string; id: string }) {
  const { peutSaisir, peutValider } = await droits(base);
  const res = await apiFetch(`/api/v1/conventions/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) {
    return <p className="text-sm text-destructive">{await messageErreur(res)}</p>;
  }
  const convention = (await res.json()) as ConventionDetail;
  const [resLettres, resActes] = await Promise.all([
    apiFetch('/api/v1/conventions/lettres-cles'),
    apiFetch('/api/v1/reference/actes'),
  ]);
  const lettres: LettreCleActive[] = resLettres.ok ? await resLettres.json() : [];
  const actes: { id: string; code: string; libelle: string; lettreCleCode?: string | null; statut?: string }[] = resActes.ok
    ? await resActes.json()
    : [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`${base}/conventions`}>
          <ArrowLeft className="size-4" />
          Conventions
        </Link>
      </Button>
      <PageTitre titre={`Convention ${convention.numero}`} description={convention.etablissement.nom} />
      <ConventionDetailEcran
        convention={convention}
        lettres={lettres}
        actesReferentiel={actes.filter((a) => a.statut !== 'RETIRE')}
        base={base}
        peutSaisir={peutSaisir}
        peutValider={peutValider}
      />
    </div>
  );
}
