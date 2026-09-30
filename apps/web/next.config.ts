import type { NextConfig } from 'next';

/**
 * Images publiques servies par Supabase Storage : événements (prisma/sql/060)
 * et logos des sociétés affichés sur leur page /{slug} (prisma/sql/058).
 */
const baseStorage = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const imagesStorage = baseStorage
  ? ['evenements', 'logos'].map((bucket) => new URL(`${baseStorage}/storage/v1/object/public/${bucket}/**`))
  : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: imagesStorage,
  },
  experimental: {
    serverActions: {
      // Téléversement des images d'événements (5 Mo max côté API) + marge
      // multipart. Par défaut 1 Mo.
      bodySizeLimit: '6mb',
    },
  },
};

export default nextConfig;
