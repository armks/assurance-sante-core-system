import type { ElementCatalogue } from '@/components/dashboard/catalogue-activation-ecran';
import { apiFetch, messageErreur } from '@/lib/api';

import type { TypeCatalogue } from './catalogue-actions';

interface Activation {
  actif: boolean;
  statut: string | null;
}

/** Catalogue national + état d'activation de l'organisation (API `GET reference/catalogue-national/...`), mis en forme pour l'écran. */
export async function chargerCatalogue(type: TypeCatalogue): Promise<{ elements: ElementCatalogue[]; erreur: string | null }> {
  const res = await apiFetch(`/api/v1/reference/catalogue-national/${type}`);
  if (!res.ok) return { elements: [], erreur: await messageErreur(res) };
  if (type === 'actes') {
    const brut = (await res.json()) as {
      id: string; code: string; libelle: string; categorie: string | null; categorieGarantie: string | null; versionNomenclature: string | null; statut: string; activation: Activation;
    }[];
    return {
      erreur: null,
      elements: brut.map((a) => ({
        id: a.id,
        code: a.code,
        libelle: a.libelle,
        rubrique: a.categorieGarantie ?? a.categorie,
        detail: a.versionNomenclature,
        statutNational: a.statut,
        actif: a.activation.actif,
        statutLocal: a.activation.statut,
      })),
    };
  }
  const brut = (await res.json()) as {
    id: string; codeProduit: string | null; codeEan: string | null; denominationCommune: string; nomCommercial: string | null; dosage: string | null; forme: string | null;
    classeTherapeutique: string | null; statutHomologation: string; activation: Activation;
  }[];
  return {
    erreur: null,
    elements: brut.map((m) => ({
      id: m.id,
      code: m.codeProduit ?? m.codeEan ?? '—',
      libelle: m.nomCommercial && m.nomCommercial.toLowerCase() !== m.denominationCommune.toLowerCase() ? `${m.denominationCommune} (${m.nomCommercial})` : m.denominationCommune,
      rubrique: m.classeTherapeutique,
      detail: [m.dosage, m.forme].filter(Boolean).join(' · ') || null,
      statutNational: m.statutHomologation,
      actif: m.activation.actif,
      statutLocal: m.activation.statut,
    })),
  };
}
