import { NextResponse } from 'next/server';

import { genererCaptcha } from '@/lib/captcha';

export const dynamic = 'force-dynamic';

/** Nouveau défi CAPTCHA (image + jeton signé). Simple GET : fonctionne derrière un tunnel ou un proxy, contrairement à une action serveur. */
export function GET() {
  return NextResponse.json(genererCaptcha(), { headers: { 'Cache-Control': 'no-store' } });
}
