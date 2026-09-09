import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/middleware';

// Next 16 : `middleware.ts` → `proxy.ts`, export `middleware` → `proxy`.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les requêtes sauf :
     * - _next/static, _next/image, favicon.ico
     * - fichiers image (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
