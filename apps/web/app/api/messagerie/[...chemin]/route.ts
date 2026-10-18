import { apiFetch } from '@/lib/api';

export const dynamic = 'force-dynamic';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** Routes de l'API de messagerie accessibles depuis le navigateur (liste blanche : rien d'autre n'est relayé). */
const ROUTES_GET = [
  /^flux$/,
  /^annuaire$/,
  /^conversations$/,
  new RegExp(`^conversations/${UUID}/messages$`, 'i'),
  new RegExp(`^conversations/${UUID}/messages/${UUID}/fichier$`, 'i'),
];
const ROUTES_POST = [
  /^conversations$/,
  new RegExp(`^conversations/${UUID}/(messages|fichiers|accepter|refuser|lu|saisie)$`, 'i'),
];

/** Une requête qui modifie l'état doit venir du site lui-même (protection contre les requêtes inter-sites). */
function memeOrigine(request: Request): boolean {
  const origine = request.headers.get('origin');
  if (!origine) return true;
  try {
    return new URL(origine).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function relayer(request: Request, chemin: string[], methode: 'GET' | 'POST') {
  const route = chemin.join('/');
  const permises = methode === 'GET' ? ROUTES_GET : ROUTES_POST;
  if (!permises.some((r) => r.test(route))) return Response.json({ message: 'Route inconnue.' }, { status: 404 });
  if (methode === 'POST' && !memeOrigine(request)) return Response.json({ message: 'Origine non autorisée.' }, { status: 403 });
  const recherche = new URL(request.url).search;

  let init: RequestInit = { method: methode, signal: request.signal };
  if (methode === 'POST') {
    const type = request.headers.get('content-type') ?? '';
    if (type.startsWith('multipart/form-data')) init = { ...init, body: await request.formData() };
    else init = { ...init, body: (await request.text()) || '{}' };
  }
  const res = await apiFetch(`/api/v1/messagerie/${route}${recherche}`, init);

  if (route === 'flux') {
    if (!res.ok || !res.body) return Response.json({ message: 'Flux indisponible.' }, { status: res.status || 502 });
    return new Response(res.body, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }
  const entetes = new Headers({ 'Cache-Control': 'no-store' });
  for (const nom of ['content-type', 'content-disposition']) {
    const v = res.headers.get(nom);
    if (v) entetes.set(nom, v);
  }
  return new Response(res.body, { status: res.status, headers: entetes });
}

export async function GET(request: Request, { params }: { params: Promise<{ chemin: string[] }> }) {
  return relayer(request, (await params).chemin, 'GET');
}

export async function POST(request: Request, { params }: { params: Promise<{ chemin: string[] }> }) {
  return relayer(request, (await params).chemin, 'POST');
}
