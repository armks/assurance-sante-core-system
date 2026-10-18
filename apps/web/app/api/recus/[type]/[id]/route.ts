import { apiFetch } from '@/lib/api';

/** Reçus de caisse : segment d'URL → route de l'API (liste blanche, l'identifiant est validé avant tout appel). */
const RECUS: Record<string, (id: string) => string> = {
  'facture-soins': (id) => `/api/v1/recus/facture-soins/${id}`,
  dispensation: (id) => `/api/v1/recus/dispensation/${id}`,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPRIMANTES = ['THERMIQUE_58', 'THERMIQUE_80', 'A4'];

/**
 * Reçu de caisse (PDF affiché pour impression) d'une facture de soins ou d'une dispensation réglée : relaie la demande à l'API avec la
 * session de l'utilisateur, sans exposer le jeton. `?imprimante=` remplace, pour ce tirage, l'imprimante paramétrée.
 */
export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const chemin = RECUS[type];
  if (!chemin || !UUID.test(id)) return Response.json({ message: 'Reçu inconnu.' }, { status: 404 });
  const imprimante = new URL(request.url).searchParams.get('imprimante');
  if (imprimante !== null && !IMPRIMANTES.includes(imprimante)) return Response.json({ message: 'Imprimante inconnue.' }, { status: 400 });
  const res = await apiFetch(`${chemin(id)}${imprimante ? `?imprimante=${imprimante}` : ''}`);
  if (!res.ok || !res.body) {
    const texte = await res.text().catch(() => '');
    let message = 'Émission du reçu impossible.';
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
      'Content-Disposition': res.headers.get('content-disposition') ?? 'inline; filename="recu.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
