import { NextResponse, type NextRequest } from 'next/server';

import { updateSession } from '@/lib/middleware';

// Visiteurs SANS session (pages publiques) : au plus LIMITE requêtes de page par minute et par adresse, contre l'aspiration automatique.
// Compteur en mémoire de l'instance (suffisant pour freiner un aspirateur ; pas de limite pour les utilisateurs connectés).
const LIMITE = 120;
const FENETRE_MS = 60_000;
const compteurs = new Map<string, { debut: number; n: number }>();

function adresse(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'inconnue';
}

function aSession(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
}

function depasseLaLimite(ip: string): boolean {
  const maintenant = Date.now();
  if (compteurs.size > 5000) for (const [k, v] of compteurs) if (maintenant - v.debut > FENETRE_MS) compteurs.delete(k);
  const c = compteurs.get(ip);
  if (!c || maintenant - c.debut > FENETRE_MS) {
    compteurs.set(ip, { debut: maintenant, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > LIMITE;
}

// Next 16 : `middleware.ts` → `proxy.ts`, export `middleware` → `proxy`.
export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !aSession(request) && depasseLaLimite(adresse(request))) {
    return new NextResponse('Trop de requêtes. Réessayez dans une minute.', { status: 429, headers: { 'Retry-After': '60' } });
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les requêtes sauf :
     * - _next/static, _next/image, favicon.ico, robots.txt (lisible sans connexion)
     * - fichiers image (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
