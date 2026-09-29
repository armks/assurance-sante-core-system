import { apiFetch } from '@/lib/api';

/**
 * Copie de l'adhérent SANS les chemins de stockage des photos (`photoUrl`,
 * adhérent et bénéficiaires) — à appliquer avant de passer l'objet à un
 * composant client : seul le serveur en a besoin (pour signer), le navigateur
 * ne reçoit que les URLs signées de `chargerPhotosFamille`.
 */
export function sansCheminsPhoto<
  T extends { photoUrl?: string | null; beneficiaires?: { photoUrl?: string | null }[] },
>(adherent: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { photoUrl, ...reste } = adherent;
  return {
    ...reste,
    ...(adherent.beneficiaires
      ? {
          beneficiaires: adherent.beneficiaires.map((b) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { photoUrl: _chemin, ...sansChemin } = b;
            return sansChemin;
          }),
        }
      : {}),
  } as T;
}

/**
 * URLs signées courte durée des photos d'une famille (adhérent + bénéficiaires),
 * résolues côté serveur via les endpoints `GET …/photo` de l'API. Le bucket
 * `photos` est privé : jamais d'URL publique permanente. L'API applique le
 * scope habituel (organisation, société, adhérent lui-même) : une photo non
 * lisible pour l'appelant revient simplement à `null`, jamais une erreur de page.
 * Server Components uniquement (utilise la session via `apiFetch`).
 */
export async function chargerPhotosFamille(adherent: {
  id: string;
  photoUrl?: string | null;
  beneficiaires?: { id: string; photoUrl?: string | null }[];
}): Promise<{ adherent: string | null; beneficiaires: Record<string, string | null> }> {
  const beneficiaires = adherent.beneficiaires ?? [];
  const signer = async (chemin: string): Promise<string | null> => {
    try {
      const res = await apiFetch(chemin);
      if (!res.ok) return null;
      const corps = (await res.json()) as { url?: string };
      return corps.url ?? null;
    } catch {
      return null;
    }
  };

  const [urlAdherent, urlsBeneficiaires] = await Promise.all([
    adherent.photoUrl ? signer(`/api/v1/member/adherents/${adherent.id}/photo`) : null,
    Promise.all(
      beneficiaires.map((b) =>
        b.photoUrl
          ? signer(`/api/v1/member/adherents/${adherent.id}/beneficiaires/${b.id}/photo`)
          : null,
      ),
    ),
  ]);

  return {
    adherent: urlAdherent,
    beneficiaires: Object.fromEntries(beneficiaires.map((b, i) => [b.id, urlsBeneficiaires[i]])),
  };
}
