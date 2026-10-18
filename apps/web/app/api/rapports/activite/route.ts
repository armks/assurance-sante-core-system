import { apiFetch } from '@/lib/api';

/**
 * Téléchargement du rapport d'activité (PDF ou Word) : relaie l'export de l'API avec la session de l'utilisateur, sans jamais
 * exposer le jeton au navigateur. Les critères sont ceux de la page (période, établissement, société, statut…).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format');
  if (format !== 'pdf' && format !== 'docx') {
    return Response.json({ message: 'Format inconnu (pdf ou docx).' }, { status: 400 });
  }
  const critere = new URLSearchParams();
  for (const [cle, valeur] of searchParams) if (valeur.trim()) critere.set(cle, valeur.trim());
  const res = await apiFetch(`/api/v1/reporting/activite/export?${critere.toString()}`);
  if (!res.ok || !res.body) {
    const texte = await res.text().catch(() => '');
    return new Response(texte || 'Export impossible.', { status: res.status || 502 });
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': res.headers.get('content-disposition') ?? `attachment; filename="rapport.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
