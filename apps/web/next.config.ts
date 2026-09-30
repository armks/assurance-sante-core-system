import type { NextConfig } from 'next';

/** Images des événements (bucket Supabase PUBLIC `evenements`, prisma/sql/060). */
const imagesEvenements = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? [new URL(`${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/evenements/**`)]
  : [];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: imagesEvenements,
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
