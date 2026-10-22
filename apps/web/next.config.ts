import type { NextConfig } from 'next';

/**
 * Images publiques servies par Supabase Storage : événements (prisma/sql/060)
 * et logos des sociétés affichés sur leur page /{slug} (prisma/sql/058).
 */
const baseStorage = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const imagesStorage = baseStorage
  ? ['evenements', 'logos'].map((bucket) => new URL(`${baseStorage}/storage/v1/object/public/${bucket}/**`))
  : [];

/**
 * En-têtes de sécurité du site. La CSP est volontairement MINIMALE (anti-iframe, pas d'objets embarqués, base fixe) : une CSP
 * stricte sur les scripts et styles casse les scripts en ligne de Next sans nonces et doit être validée en navigation réelle.
 */
const ENTETES_SECURITE = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

/** Zones internes : jamais indexées ni copiées par un robot. */
const SOURCES_INTERNES = [
  ...['dashboard', 'dashboard-adherent', 'dashboard-assureur', 'dashboard-centre-medical', 'dashboard-pharmacie', 'dashboard-societe', 'superadmin', 'profil'].map(
    (zone) => `/${zone}/:chemin*`,
  ),
  '/login',
  '/api/:chemin*',
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pas d'indice sur la technologie (en-tête X-Powered-By)
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:chemin*', headers: ENTETES_SECURITE },
      ...SOURCES_INTERNES.map((source) => ({ source, headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, noimageindex' }] })),
    ];
  },
  images: {
    remotePatterns: imagesStorage,
  },
  // développement : le site s'ouvre aussi via 127.0.0.1 et via le lien de partage (tunnel de développement) ; sinon les actions
  // serveur (dont le CAPTCHA) sont refusées et le script de la page est bloqué
  allowedDevOrigins: ['127.0.0.1', '**.devtunnels.ms', '192.168.*.*', '10.*.*.*'],
  experimental: {
    serverActions: {
      allowedOrigins: process.env.NODE_ENV === 'production' ? [] : ['127.0.0.1:3000', '**.devtunnels.ms'],
      // Téléversement des images d'événements (5 Mo max côté API) + marge
      // multipart. Par défaut 1 Mo.
      bodySizeLimit: '6mb',
    },
  },
};

export default nextConfig;
