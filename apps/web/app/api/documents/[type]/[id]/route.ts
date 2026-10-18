import { apiFetch } from '@/lib/api';

/** Documents imprimables : segment d'URL → route d'impression de l'API (liste blanche, l'identifiant est validé avant tout appel). */
const IMPRESSIONS: Record<string, (id: string) => string> = {
  'facture-soins': (id) => `/api/v1/preauthorization/factures/${id}/impression`,
  'facture-pharmacie': (id) => `/api/v1/pharmacy/dispensations/${id}/impression`,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Impression d'une facture de soins (établissement) ou de médicaments (pharmacie) en PDF ou Word : relaie la demande à l'API avec la
 * session de l'utilisateur, sans jamais exposer le jeton au navigateur. L'API contrôle le périmètre et le règlement par le patient.
 */
export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const chemin = IMPRESSIONS[type];
  if (!chemin || !UUID.test(id)) return Response.json({ message: 'Document inconnu.' }, { status: 404 });
  const format = new URL(request.url).searchParams.get('format');
  if (format !== 'pdf' && format !== 'docx') return Response.json({ message: 'Format inconnu (pdf ou docx).' }, { status: 400 });
  const res = await apiFetch(`${chemin(id)}?format=${format}`);
  if (!res.ok || !res.body) {
    const texte = await res.text().catch(() => '');
    let message = 'Impression impossible.';
    try {
      message = (JSON.parse(texte) as { message?: string }).message ?? message;
    } catch {
      // réponse non JSON : message générique
    }
    return Response.json({ message }, { status: res.status || 502 });
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') ?? `attachment; filename="facture.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
