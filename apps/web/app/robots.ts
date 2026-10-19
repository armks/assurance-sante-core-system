import type { MetadataRoute } from 'next';

/** Robots d'entraînement et d'aspiration d'IA connus : interdits partout (les robots honnêtes obéissent, les autres sont freinés ailleurs). */
const ROBOTS_IA = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'CCBot', 'Google-Extended', 'PerplexityBot',
  'Bytespider', 'Amazonbot', 'Applebot-Extended', 'FacebookBot', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'ImagesiftBot',
  'Omgilibot', 'YouBot', 'AI2Bot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ROBOTS_IA, disallow: '/' },
      { userAgent: '*', allow: '/', disallow: ['/dashboard', '/superadmin', '/profil', '/login', '/api/'] },
    ],
  };
}
