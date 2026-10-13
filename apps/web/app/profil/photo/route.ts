import { NextResponse } from 'next/server';

import { apiFetch } from '@/lib/api';

/** Photo de l'utilisateur connecté : l'API fournit une URL signée courte durée, vers laquelle on redirige (le navigateur la met en cache brièvement). */
export async function GET() {
  const res = await apiFetch('/api/v1/identity/me/photo');
  if (!res.ok) return new NextResponse(null, { status: res.status === 404 ? 404 : 502 });
  const { url } = (await res.json()) as { url: string };
  return NextResponse.redirect(url, { status: 307, headers: { 'Cache-Control': 'private, max-age=300' } });
}
