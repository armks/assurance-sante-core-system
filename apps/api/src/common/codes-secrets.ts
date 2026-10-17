import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Protection des codes à usage unique (facturation, confirmation de dispensation, consultation, ordonnance, validation
 * superadmin). Un code n'est JAMAIS stocké en clair :
 *  - la colonne d'origine contient son empreinte HMAC-SHA256 (clé secrète hors base) : sert aux recherches et à l'unicité ;
 *  - la colonne `*_chiffre` contient le code chiffré AES-256-GCM : permet de le réafficher à qui y a droit.
 * Une fuite de la base seule ne livre donc aucun code utilisable.
 */

/** Les codes sont TEMPORAIRES : durée de vie du code de facturation (à valider par le patient) et du code de confirmation de dispensation. */
export const DUREE_CODE_FACTURATION_MS = 24 * 3_600_000;
export const DUREE_CODE_CONFIRMATION_MS = 2 * 3_600_000;
export const expirationDans = (dureeMs: number) => new Date(Date.now() + dureeMs);
export const estExpire = (dateExpiration: Date | null | undefined) => !!dateExpiration && dateExpiration.getTime() <= Date.now();

/** Champs protégés, par modèle Prisma. */
export const CODES_SECRETS: Record<string, string> = {
  CodeConsultation: 'code',
  CodeOrdonnance: 'code',
  CodeValidationSuperadmin: 'code',
  FactureDossier: 'codeFacturation',
  DispensationPharmacie: 'codeConfirmation',
};

const SUFFIXE = 'Chiffre';
const VERSION = 'v1';

interface Cles {
  chiffrement: Buffer;
  empreinte: Buffer;
}
let cles: Cles | null = null;

/** Clés dérivées (HKDF) d'un secret maître `CODES_SECRET_MAITRE` (≥ 32 caractères, hors base de données). */
function lireCles(): Cles {
  if (cles) return cles;
  const maitre = process.env.CODES_SECRET_MAITRE?.trim();
  if (!maitre || maitre.length < 32) {
    throw new Error('CODES_SECRET_MAITRE absent ou trop court (32 caractères minimum) : les codes ne peuvent être ni protégés ni vérifiés.');
  }
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', maitre, 'assurance-sante-codes', info, 32));
  cles = { chiffrement: derive('chiffrement-codes'), empreinte: derive('empreinte-codes') };
  return cles;
}

/** Vrai si le secret maître est configuré — vérifié au démarrage du serveur. */
export function secretCodesConfigure(): boolean {
  try {
    lireCles();
    return true;
  } catch {
    return false;
  }
}

/** Forme canonique d'un code saisi (les codes sont en majuscules et sans espace). */
export const normaliserCode = (code: string) => code.trim().toUpperCase();

/** Empreinte HMAC-SHA256 (hex, majuscules) d'un code — déterministe, irréversible sans la clé. */
export function empreinteCode(code: string): string {
  return createHmac('sha256', lireCles().empreinte).update(normaliserCode(code)).digest('hex').toUpperCase();
}

/** Chiffre un code (AES-256-GCM, IV aléatoire) → `v1.<iv>.<tag>.<texte>` en base64url. */
export function chiffrerCode(code: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', lireCles().chiffrement, iv);
  const texte = Buffer.concat([c.update(normaliserCode(code), 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), texte.toString('base64url')].join('.');
}

/** Déchiffre un code ; lève une erreur si la valeur est altérée ou chiffrée avec une autre clé. */
export function dechiffrerCode(valeur: string): string {
  const [v, iv, tag, texte] = valeur.split('.');
  if (v !== VERSION || !iv || !tag || !texte) throw new Error('Code chiffré illisible.');
  const d = createDecipheriv('aes-256-gcm', lireCles().chiffrement, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(texte, 'base64url')), d.final()]).toString('utf8');
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Remplace un code (ou une liste / un filtre `equals`, `in`, `not`, `notIn`) par son empreinte dans un filtre `where`. */
function empreinteFiltre(valeur: unknown): unknown {
  if (typeof valeur === 'string') return empreinteCode(valeur);
  if (Array.isArray(valeur)) return valeur.map((v) => (typeof v === 'string' ? empreinteCode(v) : v));
  if (estObjet(valeur)) {
    const r: Objet = { ...valeur };
    for (const k of ['equals', 'not', 'in', 'notIn']) if (k in r) r[k] = empreinteFiltre(r[k]);
    return r;
  }
  return valeur;
}

/** Réécrit un `where` : le champ protégé est comparé par empreinte (AND / OR / NOT traversés). */
function reecrireWhere(where: unknown, champ: string): unknown {
  if (Array.isArray(where)) return where.map((w) => reecrireWhere(w, champ));
  if (!estObjet(where)) return where;
  const r: Objet = {};
  for (const [k, v] of Object.entries(where)) {
    r[k] = k === champ ? empreinteFiltre(v) : k === 'AND' || k === 'OR' || k === 'NOT' ? reecrireWhere(v, champ) : v;
  }
  return r;
}

/** Réécrit un `data` d'écriture : champ en empreinte + version chiffrée. */
function reecrireData(data: unknown, champ: string): unknown {
  if (Array.isArray(data)) return data.map((d) => reecrireData(d, champ));
  if (!estObjet(data) || !(champ in data)) return data;
  const brut = data[champ];
  const valeur = estObjet(brut) && 'set' in brut ? brut.set : brut;
  if (typeof valeur === 'string') return { ...data, [champ]: empreinteCode(valeur), [champ + SUFFIXE]: chiffrerCode(valeur) };
  if (valeur === null) return { ...data, [champ]: null, [champ + SUFFIXE]: null };
  return data;
}

/** Parcourt un résultat : partout où un code chiffré accompagne son empreinte, remet le code lisible. */
function restituer(valeur: unknown, champs: ReadonlySet<string>): unknown {
  if (Array.isArray(valeur)) return valeur.map((v) => restituer(v, champs));
  if (!estObjet(valeur)) return valeur;
  const r: Objet = {};
  for (const [k, v] of Object.entries(valeur)) {
    if (k.endsWith(SUFFIXE) && champs.has(k.slice(0, -SUFFIXE.length))) continue;
    r[k] = restituer(v, champs);
  }
  for (const champ of champs) {
    const chiffre = valeur[champ + SUFFIXE];
    if (typeof chiffre === 'string' && champ in valeur) r[champ] = dechiffrerCode(chiffre);
  }
  return r;
}

const TOUS_LES_CHAMPS: ReadonlySet<string> = new Set(Object.values(CODES_SECRETS));

/**
 * Applique la protection à une opération Prisma : pour un modèle concerné, recherches par empreinte et écritures en
 * empreinte + chiffré ; pour tout modèle qui charge des relations (`include` / `select`), les codes des modèles liés
 * sont restitués en clair. À brancher dans `$allModels.$allOperations`.
 */
export async function protegerCodes(
  model: string,
  args: Objet,
  query: (a: Objet) => Promise<unknown>,
): Promise<unknown> {
  const champ = CODES_SECRETS[model];
  const a: Objet = { ...args };
  if (champ) {
    if ('where' in a) a.where = reecrireWhere(a.where, champ);
    if ('data' in a) a.data = reecrireData(a.data, champ);
    if ('create' in a) a.create = reecrireData(a.create, champ);
    if ('update' in a) a.update = reecrireData(a.update, champ);
    // un `select` du code doit aussi ramener sa version chiffrée, pour pouvoir le restituer
    if (estObjet(a.select) && a.select[champ] && !a.select[champ + SUFFIXE]) a.select = { ...a.select, [champ + SUFFIXE]: true };
  }
  const resultat = await query(a);
  return champ || a.include || a.select ? restituer(resultat, TOUS_LES_CHAMPS) : resultat;
}
