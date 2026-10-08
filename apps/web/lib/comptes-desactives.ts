import type { CompteDesactiveResume } from '@/components/dashboard/tout-reactiver';
import { apiFetch } from '@/lib/api';

export interface DesactivesParPerimetre {
  etablissements: Record<string, CompteDesactiveResume[]>;
  pharmacies: Record<string, CompteDesactiveResume[]>;
  societes: Record<string, CompteDesactiveResume[]>;
}

interface CompteListe {
  id: string;
  email: string | null;
  role: string | null;
  statut?: string;
  desactiveLe?: string | null;
  etablissementId?: string | null;
  pharmacieId?: string | null;
  societeId?: string | null;
}

/**
 * Comptes DÉSACTIVÉS par un archivage (pas les comptes révoqués à la main), groupés par périmètre :
 * alimente les boutons « Tout réactiver ». Vide si l'appelant n'a pas accès à la liste des comptes.
 */
export async function comptesDesactivesParPerimetre(): Promise<DesactivesParPerimetre> {
  const vide: DesactivesParPerimetre = { etablissements: {}, pharmacies: {}, societes: {} };
  const res = await apiFetch('/api/v1/identity/comptes');
  if (!res.ok) return vide;
  const comptes = (await res.json()) as CompteListe[];
  for (const c of comptes) {
    if (!c.desactiveLe || c.statut === 'REVOQUE') continue;
    const r = { id: c.id, email: c.email, role: c.role };
    const [groupe, cle] = c.etablissementId
      ? [vide.etablissements, c.etablissementId]
      : c.pharmacieId
        ? [vide.pharmacies, c.pharmacieId]
        : c.societeId
          ? [vide.societes, c.societeId]
          : [null, null];
    if (groupe && cle) (groupe[cle] ??= []).push(r);
  }
  return vide;
}
