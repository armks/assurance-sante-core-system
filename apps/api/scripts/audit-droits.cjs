/**
 * Audit des droits de l'API (contrôle de non-régression sécurité).
 *
 *   npx nest build                                → produit dist/
 *   node scripts/audit-droits.cjs                 → LECTURES seulement (sans effet sur les données) :
 *                                                   401 sans jeton, aucune lecture en 500, comptes de test supprimés à la fin
 *   node scripts/audit-droits.cjs --ecritures     → rejoue aussi les routes d'ÉCRITURE avec des profils peu privilégiés
 *                                                   (modifie les données de démonstration : relancer ensuite
 *                                                   `node scripts/seed-demo.cjs`, qui supprime aussi les comptes `+aud…`)
 *
 * Démarre l'application sur le port 3011 (sans ValidationPipe en mode --ecritures) : les contrôles de rôle des services s'exécutent avant toute erreur
 * de validation. Chaque route trouvée dans le routeur est appelée avec des comptes de test éphémères.
 * Code de sortie non nul si :
 *  - une route (hors routes publiques connues) répond autre chose que 401 sans jeton ;
 *  - une lecture répond 500 ;
 *  - (--ecritures) une écriture d'un profil externe n'est pas refusée, hors exceptions connues et justifiées.
 * Identifiants réels : uniquement des entités de démonstration (préfixe `de0d`), jamais de données réelles.
 */
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
require('dotenv').config({ path: __dirname + '/../../web/.env.local', quiet: true });
const { ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require('../dist/app.module');

const ECRITURES = process.argv.includes('--ecritures');
const UUID = '00000000-0000-4000-8000-000000000001';
const PARAMS = { slug: 'assureur-test-a', token: 'jeton-inexistant', entite: 'etablissement', action: 'supprimer', format: 'pdf' };
const PUBLIQUES = ['/invitations/token/:token', '/invitations/accepter', '/sante'];
const PREFIXES_PUBLICS = ['/public/'];
const PREFIXES_EXCLUS = ['/member/imports-adherents', '/reference/', '/superadmin', '/identity/me'];
/** Écritures d'un profil externe tolérées sans 403, avec la raison. */
const TOLEREES = [
  [/^\/underwriting\/questionnaires$/, 'questionnaire médical rempli par l’adhérent (validation du corps de requête)'],
  [/justification$/, 'pièce justificative transmise par l’établissement ou la pharmacie contestée (validation du corps)'],
  [/^\/preauthorization\/ordonnances$/, 'création d’ordonnance : rôle contrôlé après validation du corps'],
  [/valider-code|codes-consultation\/valider|codes-facturation\/valider/, 'saisie de code : corps indéfini sans ValidationPipe'],
  [/^\/member\/adherents\/:id\/beneficiaires\/proposition$/, 'l’adhérent propose lui-même un bénéficiaire (validé ensuite par la société / l’assureur)'],
  [/^\/preauthorization\/codes-consultation$/, 'l’adhérent demande lui-même un code de consultation (corps obligatoire en production)'],
  [/^\/invitations$/, 'autorisation par règle de provisioning (rôle créateur → rôle créé) ; corps obligatoire en production'],
];
const EXTERNES = ['ADHERENT_TITULAIRE', 'SOCIETE_RECEPTION', 'PHARMACIE_CAISSIERE'];

(async () => {
  const prisma = new PrismaClient();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anon = createClient(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const org = 'aaaaaaaa-0000-0000-0000-000000000001';
  const un = async (sql) => (await prisma.$queryRawUnsafe(sql))[0];
  const etab = await un("SELECT id::text FROM etablissements_sante WHERE code='DE01'");
  const pharm = await un("SELECT id::text FROM pharmacies WHERE code='DP01'");
  const soc = await un("SELECT id::text FROM souscripteurs WHERE id::text LIKE 'de0d%' LIMIT 1");
  const adh = await un(`SELECT id::text FROM adherents WHERE id::text LIKE 'de0d%' AND souscripteur_id = '${soc.id}'::uuid LIMIT 1`);
  if (!etab || !pharm || !soc || !adh) throw new Error('Données de démonstration absentes : lancer `node scripts/seed-demo.cjs` d’abord.');

  // identifiants réels de démonstration, pour que les contrôles d'accès soient atteints (et non un simple 404)
  const ben = await un("SELECT id::text, adherent_id::text AS a FROM beneficiaires WHERE id::text LIKE 'de0d%' LIMIT 1");
  const id = async (table, filtre = '') => (await un(`SELECT id::text FROM ${table} WHERE id::text LIKE 'de0d%' ${filtre} LIMIT 1`))?.id;
  const reel = {
    adherent: await id('adherents'),
    dossier: await id('dossiers_soins'),
    ticket: await id('tickets_soins'),
    acte: await id('actes_dossier'),
    facture: await id('factures_dossier'),
    mens: await id('factures_mensuelles_etablissement', "AND statut='SOUMISE'"),
    mensPh: await id('factures_mensuelles_pharmacie', "AND statut='SOUMISE'"),
    disp: await id('dispensations_pharmacie'),
    etab: await id('etablissements_sante'),
    pharm: await id('pharmacies'),
    recl: await id('reclamations'),
    police: await id('polices'),
    socs: await id('souscripteurs'),
    cota: await id('cotisations'),
    compte: await id('comptes_financiers'),
    conte: await id('contestations_acte'),
    inv: (await un('SELECT id::text FROM invitations ORDER BY created_at LIMIT 1'))?.id,
  };
  const REELS = [
    ['/member/adherents/:id/beneficiaires/:beneficiaireId', { id: ben.a, beneficiaireId: ben.id }],
    ['/member/adherents/:id', { id: reel.adherent }],
    ['/invitations/:id', { id: reel.inv }],
    ['/claims/reclamations/:id', { id: reel.recl }],
    ['/care-episode/dossiers/:id', { id: reel.dossier }],
    ['/preauthorization/tickets-soins/:id', { id: reel.ticket }],
    ['/preauthorization/actes/:id', { id: reel.acte }],
    ['/preauthorization/dossiers/:id', { id: reel.dossier }],
    ['/preauthorization/factures-mensuelles-etablissement/:id', { id: reel.mens }],
    ['/preauthorization/factures-mensuelles-pharmacie/:id', { id: reel.mensPh }],
    ['/preauthorization/factures/:id', { id: reel.facture }],
    ['/pharmacy/dispensations/:id', { id: reel.disp }],
    ['/provider/etablissements/:id', { id: reel.etab }],
    ['/provider/pharmacies/:id', { id: reel.pharm }],
    ['/policy/polices/:id', { id: reel.police }],
    ['/contestation/contestations-actes/:id', { id: reel.conte }],
    ['/billing/cotisations/:id', { id: reel.cota }],
    ['/comptes/comptes/:id', { id: reel.compte }],
    ['/member/souscripteurs/:souscripteurId', { souscripteurId: reel.socs }],
  ];
  const remplir = (chemin) => {
    let r = chemin;
    const regle = REELS.find(([p]) => chemin.startsWith(p));
    if (regle) for (const [nom, val] of Object.entries(regle[1])) r = r.replace(':' + nom, val);
    return r.replace(/:([A-Za-z]+)/g, (_, n) => PARAMS[n] ?? UUID);
  };

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  // lectures : validation active comme en production (paramètre manquant → 400) ; écritures : sans validation, pour atteindre les contrôles de rôle
  if (!ECRITURES) app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3011);
  const BASE = 'http://localhost:3011/api/v1';
  const pile = (app.getHttpAdapter().getInstance().router || app.getHttpAdapter().getInstance()._router).stack;
  const routes = [];
  for (const l of pile) {
    if (!l.route) continue;
    for (const m of Object.keys(l.route.methods)) {
      const chemin = l.route.path.replace(/^\/api\/v1/, '');
      if (PREFIXES_PUBLICS.some((p) => chemin.startsWith(p)) || PREFIXES_EXCLUS.some((p) => chemin.startsWith(p))) continue;
      if (!ECRITURES && m !== 'get') continue;
      routes.push([m.toUpperCase(), chemin]);
    }
  }

  const profils = [
    ['ADHERENT_TITULAIRE', { adherentId: adh.id, societeId: soc.id }],
    ['SOCIETE_RECEPTION', { societeId: soc.id }],
    ['PHARMACIE_CAISSIERE', { pharmacieId: pharm.id }],
    ['CENTRE_MEDICAL_ACCUEIL', { etablissementId: etab.id }],
    ['ASSUREUR_MEDECIN_CONSEIL', {}],
  ];
  const comptes = [];
  const jetons = {};
  for (const [role, extra] of profils) {
    const email = 'armelk01+aud' + Date.now() + Math.floor(Math.random() * 999) + '@gmail.com';
    const { data: c } = await admin.auth.admin.createUser({ email, password: 'Perf!12345678', email_confirm: true });
    await prisma.profil.create({ data: { id: c.user.id, role, organisationId: org, ...extra } });
    comptes.push(c.user.id);
    const { data: s } = await anon.auth.signInWithPassword({ email, password: 'Perf!12345678' });
    jetons[role] = s.session.access_token;
  }

  const appeler = async (verbe, chemin, jeton) => {
    const init = { method: verbe, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: 'Bearer ' + jeton } : {}) } };
    if (!['GET', 'DELETE'].includes(verbe)) init.body = '{}';
    try {
      return (await fetch(BASE + remplir(chemin), init)).status;
    } catch {
      return 'ERR';
    }
  };

  let anomalies = 0;
  const signaler = (txt) => {
    anomalies++;
    console.log('ANOMALIE :', txt);
  };
  // 1) sans jeton : 401 partout
  for (const [verbe, chemin] of routes) {
    const st = await appeler(verbe, chemin, null);
    if (st !== 401 && !PUBLIQUES.includes(chemin)) signaler(`${verbe} ${chemin} répond ${st} sans jeton (attendu 401)`);
  }
  // 2) profils peu privilégiés
  const bilan = {};
  for (const [role] of profils) {
    bilan[role] = { lectures200: 0, ecritures: 0, ecrituresRefusees: 0 };
    for (const [verbe, chemin] of routes) {
      const st = await appeler(verbe, chemin, jetons[role]);
      if (verbe === 'GET') {
        // sans ValidationPipe (mode écritures), un paramètre manquant donne un 500 attendu : seules les lectures sont jugées
        if (st === 500 && !ECRITURES) signaler(`${role} : GET ${chemin} répond 500`);
        if (st === 200) bilan[role].lectures200++;
        continue;
      }
      bilan[role].ecritures++;
      if (st === 403 || st === 401) bilan[role].ecrituresRefusees++;
      if (EXTERNES.includes(role) && ![401, 403, 429, 404, 409, 410].includes(st) && !TOLEREES.some(([re]) => re.test(chemin))) {
        signaler(`${role} : ${verbe} ${chemin} répond ${st} (écriture non refusée)`);
      }
    }
  }
  console.log(`${routes.length} routes${ECRITURES ? ' (lectures et écritures)' : ' (lectures)'} × ${profils.length} profils + passe sans jeton.`);
  for (const [role, b] of Object.entries(bilan)) console.log(`  ${role.padEnd(28)} lectures autorisées : ${b.lectures200}` + (ECRITURES ? `, écritures refusées : ${b.ecrituresRefusees}/${b.ecritures}` : ''));
  console.log(anomalies ? `${anomalies} ANOMALIE(S).` : 'Aucune anomalie.');

  // en mode écritures, une route autorisée peut référencer les comptes de test : suppression laissée à seed-demo
  if (!ECRITURES) {
    for (const cid of comptes) {
      await prisma.profil.deleteMany({ where: { id: cid } });
      await admin.auth.admin.deleteUser(cid);
    }
  }
  await prisma.$disconnect();
  await app.close();
  process.exit(anomalies ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
