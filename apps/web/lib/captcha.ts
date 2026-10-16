import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * CAPTCHA auto-hébergé (aucun service tiers) pour la connexion et la création de compte.
 *
 * Défi : 5 caractères lisibles (sans 0/O, 1/I/L) dessinés en SVG avec rotation, décalage, bruit et traits. Le jeton signé
 * (HMAC-SHA256) lie l'identifiant, l'expiration et la RÉPONSE : le navigateur ne reçoit jamais la réponse, seulement l'image.
 * Chaque jeton ne sert qu'UNE fois, juste ou faux (impossible d'essayer plusieurs réponses sur la même image), et expire en 3 minutes.
 *
 * Limites connues : la mémoire des jetons utilisés est celle du processus (une seule instance) ; avec plusieurs instances, partager
 * la liste (Redis / table) ou définir `CAPTCHA_SECRET` identique partout et accepter qu'un jeton puisse resservir sur une autre
 * instance. Sans `CAPTCHA_SECRET`, une clé aléatoire est tirée au démarrage (les jetons ne survivent pas à un redémarrage).
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LONGUEUR = 5;
const DUREE_VIE_MS = 3 * 60_000;
const LARGEUR = 190;
const HAUTEUR = 60;

const secret = process.env.CAPTCHA_SECRET?.trim() || randomBytes(32).toString('hex');
const utilises = new Map<string, number>();

const signer = (donnees: string) => createHmac('sha256', secret).update(donnees).digest('base64url');
const normaliser = (reponse: string) => reponse.replace(/\s+/g, '').toUpperCase();

function purger(maintenant: number) {
  for (const [id, exp] of utilises) if (exp < maintenant) utilises.delete(id);
}

function dessiner(texte: string): string {
  const alea = (min: number, max: number) => min + (randomInt(0, 10_000) / 10_000) * (max - min);
  const couleur = () => `hsl(${randomInt(0, 360)} ${randomInt(45, 75)}% ${randomInt(25, 42)}%)`;
  const traits = Array.from({ length: 6 }, () => {
    const d = `M${alea(0, LARGEUR).toFixed(1)} ${alea(0, HAUTEUR).toFixed(1)} Q${alea(0, LARGEUR).toFixed(1)} ${alea(0, HAUTEUR).toFixed(1)} ${alea(0, LARGEUR).toFixed(1)} ${alea(0, HAUTEUR).toFixed(1)}`;
    return `<path d="${d}" stroke="${couleur()}" stroke-width="${alea(1, 2).toFixed(1)}" fill="none" opacity="0.55"/>`;
  }).join('');
  const points = Array.from({ length: 45 }, () => `<circle cx="${alea(0, LARGEUR).toFixed(1)}" cy="${alea(0, HAUTEUR).toFixed(1)}" r="${alea(0.6, 1.6).toFixed(1)}" fill="${couleur()}" opacity="0.5"/>`).join('');
  const pas = (LARGEUR - 30) / LONGUEUR;
  const lettres = [...texte]
    .map((c, i) => {
      const x = 18 + i * pas + alea(-3, 3);
      const y = HAUTEUR / 2 + 11 + alea(-6, 6);
      const rot = alea(-24, 24).toFixed(1);
      const taille = randomInt(30, 38);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Verdana, Arial, sans-serif" font-weight="700" font-size="${taille}" fill="${couleur()}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)}) skewX(${alea(-12, 12).toFixed(1)})">${c}</text>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGEUR}" height="${HAUTEUR}" viewBox="0 0 ${LARGEUR} ${HAUTEUR}"><rect width="100%" height="100%" fill="#f4f6f8"/>${points}${lettres}${traits}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export interface DefiCaptcha {
  /** Jeton signé à renvoyer avec la réponse (ne contient pas la réponse en clair). */
  jeton: string;
  /** Image du défi (data URL SVG). */
  image: string;
}

/** Nouveau défi. */
export function genererCaptcha(): DefiCaptcha {
  const texte = Array.from({ length: LONGUEUR }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
  const id = randomBytes(9).toString('base64url');
  const exp = Date.now() + DUREE_VIE_MS;
  const signature = signer(`${id}.${exp}.${texte}`);
  return { jeton: `${id}.${exp}.${signature}`, image: dessiner(texte) };
}

export type ResultatCaptcha = { ok: true } | { ok: false; error: string };

/** Vérifie la réponse ; le jeton est consommé quel que soit le résultat. */
export function verifierCaptcha(jeton: string | undefined, reponse: string | undefined): ResultatCaptcha {
  const maintenant = Date.now();
  purger(maintenant);
  const invalide: ResultatCaptcha = { ok: false, error: 'Vérification de sécurité incorrecte ou expirée. Recopiez les caractères de la nouvelle image.' };
  if (!jeton || !reponse) return { ok: false, error: 'Recopiez les caractères de l’image avant de valider.' };
  const parties = jeton.split('.');
  if (parties.length !== 3) return invalide;
  const [id, expTexte, signature] = parties;
  const exp = Number(expTexte);
  if (!Number.isFinite(exp) || exp < maintenant || utilises.has(id)) return invalide;
  utilises.set(id, exp);
  const attendue = signer(`${id}.${exp}.${normaliser(reponse)}`);
  const a = Buffer.from(attendue);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : invalide;
}
