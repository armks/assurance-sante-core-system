import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Texte officiel de la Nomenclature générale des actes de médecine et de biologie de Côte d'Ivoire (PDF) : relayé depuis l'API avec la
 * session de l'utilisateur (le fichier est dans un stockage privé, jamais exposé directement).
 */
export async function GET() {
  const res = await apiFetch('/api/v1/reference/nomenclature-ngambci');
  if (!res.ok || !res.body) {
    const texte = await res.text().catch(() => '');
    let message = 'Document indisponible.';
    try {
      message = (JSON.parse(texte) as { message?: string }).message ?? message;
    } catch {
      // réponse non JSON : message générique
    }
    return Response.json({ message }, { status: res.status || 502 });
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': res.headers.get('content-disposition') ?? 'inline; filename="NGAMBCI-decembre-2019.pdf"',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
