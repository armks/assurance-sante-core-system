/**
 * Jeu de données de démonstration (sociétés, adhérents, établissements, pharmacies, dossiers de soins, consultations,
 * actes, pré-autorisations, ordonnances, dispensations, factures, factures mensuelles, cotisations, contestations,
 * réclamations, comptes financiers) pour alimenter rapports et statistiques.
 *
 *   node scripts/seed-demo.cjs           → nettoie l'ancien jeu de démo puis le recrée
 *   node scripts/seed-demo.cjs --clean   → supprime seulement le jeu de démo
 *
 * Toutes les lignes créées portent un identifiant commençant par `de0d` (comptes de test : e-mail `armelk01+demo-…`),
 * donc le nettoyage ne touche jamais aux données réelles. Les nouvelles lignes sont des copies de lignes existantes
 * (modèles) : les contraintes et colonnes restent cohérentes avec le schéma. Déterministe (même jeu à chaque fois).
 */
require('dotenv').config({ path: __dirname + '/../.env', quiet: true });
require('dotenv').config({ path: __dirname + '/../../web/.env.local', quiet: true });
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const { empreinteCode, chiffrerCode } = require('../src/common/codes-secrets.ts');

const prisma = new PrismaClient();
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---------- utilitaires ----------
let graine = 20261017;
const alea = () => {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entier = (a, b) => a + Math.floor(alea() * (b - a + 1));
const choix = (l) => l[Math.floor(alea() * l.length)];
const pondere = (paires) => {
  const total = paires.reduce((s, [, p]) => s + p, 0);
  let r = alea() * total;
  for (const [v, p] of paires) { r -= p; if (r <= 0) return v; }
  return paires[paires.length - 1][0];
};
const idDemo = (cle) => {
  const h = crypto.createHash('md5').update(`demo:${cle}`).digest('hex');
  return `de0d${h.slice(0, 4)}-${h.slice(4, 8)}-4${h.slice(8, 11)}-8${h.slice(11, 14)}-${h.slice(14, 26)}`;
};
const pad = (n, l) => String(n).padStart(l, '0');
const jour = (d) => new Date(d).toISOString().slice(0, 10);
const ajouteJours = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
const ajouteHeures = (d, n) => new Date(new Date(d).getTime() + n * 3600000);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codes = new Set();
const codeAlea = () => { for (;;) { let c = ''; for (let i = 0; i < 7; i++) c += ALPHABET[Math.floor(alea() * ALPHABET.length)]; if (!codes.has(c)) { codes.add(c); return c; } } };
const arrondi = (n) => Math.round(n);

const tables = {};
async function modele(table, where = 'true') {
  const [r] = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS j FROM public."${table}" t WHERE ${where} ORDER BY 1 LIMIT 1`).catch(() => [null]);
  return r ? r.j : null;
}
const defauts = {};
/**
 * Insère des lignes JSON. Une valeur absente de jsonb_populate_recordset vaudrait NULL (pas la valeur par défaut) : les
 * colonnes NOT NULL à valeur par défaut laissées à null sont donc retirées de la ligne, et les lignes sont groupées par
 * jeu de colonnes pour que PostgreSQL applique ces défauts.
 */
async function inserer(table, lignes) {
  if (!lignes.length) return;
  if (!defauts[table]) {
    const r = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND is_nullable='NO' AND column_default IS NOT NULL`);
    defauts[table] = new Set(r.map((x) => x.column_name));
  }
  const groupes = new Map();
  for (const l of lignes) {
    const o = {};
    for (const [k, v] of Object.entries(l)) if (!(v === null && defauts[table].has(k))) o[k] = v;
    const cle = Object.keys(o).sort().join(',');
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(o);
  }
  for (const [cle, lot] of groupes) {
    const cols = cle.split(',').map((c) => `"${c}"`).join(', ');
    for (let i = 0; i < lot.length; i += 150) {
      await prisma.$executeRawUnsafe(`INSERT INTO public."${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, JSON.stringify(lot.slice(i, i + 150)));
    }
  }
  tables[table] = (tables[table] || 0) + lignes.length;
}

const TRIGGERS = [
  ['actes_dossier', 'trg_verifier_ticket_ouvert'],
  ['consultations_dossier', 'trg_verifier_medecin_traitant'],
  ['lignes_facturation', 'trg_verifier_acte_realise_facturation'],
  ['lignes_facturation', 'lignes_facturation_tarif_fige'],
  ['factures_dossier', 'trg_verifier_facture_reglable'],
  ['dispensations_pharmacie', 'trg_verifier_dispensation_payable'],
];
const basculerTriggers = (etat) => Promise.all(TRIGGERS.map(([t, g]) => prisma.$executeRawUnsafe(`ALTER TABLE public."${t}" ${etat} TRIGGER "${g}"`)));

// ---------- nettoyage ----------
const SUPPRESSION_AVANT_COMPTES = ['mouvements_financiers', 'comptes_financiers', 'remboursements', 'reclamations', 'contestations_acte', 'lignes_facturation', 'factures_dossier', 'factures_mensuelles_etablissement', 'factures_mensuelles_pharmacie', 'lignes_dispensation', 'dispensations_pharmacie', 'lignes_ordonnance', 'ordonnances', 'actes_dossier', 'consultations_dossier', 'tickets_soins', 'dossiers_soins', 'cotisations', 'beneficiaires', 'adherents', 'polices', 'souscripteurs'];
async function nettoyer() {
  await basculerTriggers('DISABLE').catch(() => {});
  try {
    // comptes de démonstration et comptes éphémères de l'audit des droits (scripts/audit-droits.cjs --ecritures)
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const comptes = (data?.users || []).filter((x) => /\+(demo-|aud\d)/.test(x.email || ''));
    // 1) ces profils ne doivent plus référencer de société, adhérent, établissement ou pharmacie à supprimer
    for (const u of comptes) {
      await prisma.$executeRawUnsafe(`UPDATE public.profils SET adherent_id = NULL, societe_id = NULL, etablissement_id = NULL, pharmacie_id = NULL WHERE id = $1::uuid`, u.id);
    }
    // 2) données de démonstration (les lignes qui référencent ces comptes, ex. vérifications de factures, partent avec elles)
    for (const t of SUPPRESSION_AVANT_COMPTES) await prisma.$executeRawUnsafe(`DELETE FROM public."${t}" WHERE id::text LIKE 'de0d%'`);
    // 3) comptes (profils supprimés en cascade), puis établissements et pharmacies qu'ils référençaient
    for (const u of comptes) await admin.auth.admin.deleteUser(u.id);
    for (const t of ['pharmacies', 'etablissements_sante']) await prisma.$executeRawUnsafe(`DELETE FROM public."${t}" WHERE id::text LIKE 'de0d%'`);
  } finally {
    await basculerTriggers('ENABLE');
  }
}

// ---------- données de référence ----------
const NOMS = ['Kouassi', 'Konan', 'Yao', 'Koffi', 'Kouadio', 'Traoré', 'Coulibaly', 'Diallo', 'Ouattara', 'Bamba', 'Soro', 'N’Guessan', 'Aka', 'Koné', 'Touré', 'Diomandé', 'Fofana', 'Gnahoré', 'Tapé', 'Zadi', 'Brou', 'Ahoussou', 'Yéo', 'Doumbia', 'Sangaré', 'Camara', 'Bakayoko', 'Tano', 'Assi', 'Boni'];
const PRENOMS_M = ['Jean', 'Kouamé', 'Ibrahim', 'Serge', 'Marc', 'Issouf', 'Patrice', 'Yves', 'Alain', 'Mamadou', 'Franck', 'Eric', 'Désiré', 'Lassina', 'Adama'];
const PRENOMS_F = ['Marie', 'Aminata', 'Fatoumata', 'Awa', 'Christelle', 'Nadège', 'Mariam', 'Sylvie', 'Estelle', 'Adjoua', 'Affoué', 'Rokia', 'Josiane', 'Kadidja', 'Prisca'];
const SOCIETES = [
  ['Société Ivoirienne de Banque Atlantique', 'ENTREPRISE', 'Banque et finance', 420], ['Agro Cacao Côte d’Ivoire SA', 'ENTREPRISE', 'Agro-industrie', 310],
  ['Transports Lagunaires Abidjan', 'ENTREPRISE', 'Transport', 180], ['Cimenterie du Golfe', 'ENTREPRISE', 'Industrie', 260],
  ['Télécom Eburnie', 'ENTREPRISE', 'Télécommunications', 350], ['Groupe Scolaire Les Palmiers', 'ENTREPRISE', 'Éducation', 95],
  ['Coopérative Hévéicole du Sud-Comoé', 'ENTREPRISE', 'Agriculture', 140], ['Mairie de Cocody', 'COLLECTIVITE', 'Administration', 520],
  ['Mutuelle des Enseignants de Bouaké', 'COLLECTIVITE', 'Éducation', 230],
];
const ETABLISSEMENTS = [
  ['Polyclinique Sainte Anne-Marie', 'CLINIQUE_PRIVEE', 'Cocody', 5.3600, -3.9980], ['CHU de Treichville', 'HOPITAL_PUBLIC', 'Treichville', 5.2950, -4.0050],
  ['Centre de Santé Urbain d’Abobo', 'CENTRE_SANTE', 'Abobo', 5.4160, -4.0180], ['Laboratoire Biolab Plateau', 'LABORATOIRE', 'Plateau', 5.3200, -4.0200],
  ['Centre d’Imagerie Médicale Riviera', 'CENTRE_IMAGERIE', 'Cocody', 5.3550, -3.9500], ['Cabinet Dentaire Dr Kouamé', 'DENTISTE', 'Marcory', 5.3000, -3.9900],
  ['Maternité Notre-Dame de la Paix', 'MATERNITE', 'Yopougon', 5.3400, -4.0800], ['Clinique Internationale d’Abidjan', 'CLINIQUE_PRIVEE', 'Cocody', 5.3700, -3.9800],
];
const PHARMACIES = [
  ['Pharmacie de la Riviera', 'Cocody'], ['Pharmacie Saint Michel', 'Treichville'], ['Pharmacie du Plateau', 'Plateau'],
  ['Pharmacie Yopougon Siporex', 'Yopougon'], ['Pharmacie Abobo Gare', 'Abobo'],
];
const ACTES = [
  ['CONSULTATION', 'Consultation médecine générale', 'CS001', 5000, 8000], ['CONSULTATION', 'Consultation spécialiste', 'CS002', 12000, 20000],
  ['ANALYSES', 'Numération formule sanguine', 'AN010', 6000, 9000], ['ANALYSES', 'Glycémie à jeun', 'AN011', 2500, 4000], ['ANALYSES', 'Bilan lipidique complet', 'AN012', 12000, 18000], ['ANALYSES', 'Goutte épaisse (paludisme)', 'AN013', 2000, 3500],
  ['IMAGERIE', 'Échographie abdominale', 'IM020', 20000, 35000], ['IMAGERIE', 'Radiographie thoracique', 'IM021', 15000, 25000], ['IMAGERIE', 'Scanner cérébral', 'IM022', 90000, 140000],
  ['HOSPITALISATION', 'Hospitalisation médecine (par jour)', 'HO030', 25000, 45000], ['HOSPITALISATION', 'Hospitalisation chirurgie (par jour)', 'HO031', 40000, 80000],
  ['MATERNITE', 'Accouchement voie basse', 'MA040', 120000, 220000], ['MATERNITE', 'Consultation prénatale', 'MA041', 8000, 15000],
  ['DENTAIRE', 'Détartrage', 'DE050', 12000, 20000], ['DENTAIRE', 'Extraction dentaire', 'DE051', 15000, 30000],
  ['SOINS_INFIRMIERS', 'Pansement', 'SI060', 2000, 4000], ['SOINS_INFIRMIERS', 'Injection intramusculaire', 'SI061', 1500, 3000],
  ['ACTE_TECHNIQUE', 'Électrocardiogramme', 'AT070', 10000, 18000], ['ACTE_TECHNIQUE', 'Petite chirurgie (suture)', 'AT071', 20000, 40000],
  ['OPTIQUE', 'Verres correcteurs (paire)', 'OP080', 30000, 60000], ['TRANSPORT', 'Ambulance intra-urbaine', 'TR090', 15000, 25000],
];
const CATEGORIES_PREAUTH = new Set(['HOSPITALISATION', 'IMAGERIE', 'MATERNITE', 'OPTIQUE']);
const TAUX = { CONSULTATION: 0.8, ANALYSES: 0.8, IMAGERIE: 0.7, HOSPITALISATION: 0.85, MATERNITE: 0.9, DENTAIRE: 0.6, SOINS_INFIRMIERS: 0.8, ACTE_TECHNIQUE: 0.75, OPTIQUE: 0.5, TRANSPORT: 0.7, AUTRE: 0.7 };
const MEDICAMENTS = [['Paracétamol 500 mg cp', 600, '1 cp 3/j', '5 jours'], ['Amoxicilline 1 g cp', 1800, '1 cp 2/j', '7 jours'], ['Artéméther-Luméfantrine cp', 2500, '4 cp 2/j', '3 jours'], ['Ibuprofène 400 mg cp', 900, '1 cp 3/j', '5 jours'], ['Oméprazole 20 mg gél', 1500, '1 gél/j', '14 jours'], ['Métformine 850 mg cp', 1200, '1 cp 2/j', '30 jours'], ['Amlodipine 5 mg cp', 1400, '1 cp/j', '30 jours'], ['Ciprofloxacine 500 mg cp', 2200, '1 cp 2/j', '7 jours'], ['Vitamine C 500 mg cp', 700, '1 cp/j', '10 jours'], ['Sérum de réhydratation orale', 400, '1 sachet après chaque selle', '3 jours'], ['Diclofénac 50 mg cp', 1100, '1 cp 2/j', '5 jours'], ['Salbutamol spray', 3500, '2 bouffées si besoin', '1 mois']];
const MOTIFS = ['Fièvre persistante', 'Maux de tête', 'Douleurs abdominales', 'Toux et difficultés respiratoires', 'Contrôle de tension', 'Suivi diabète', 'Douleur dentaire', 'Paludisme suspecté', 'Lombalgie', 'Suivi de grossesse', 'Bilan de santé', 'Diarrhée'];
const DIAGNOSTICS = ['Paludisme simple', 'Gastro-entérite', 'Hypertension artérielle', 'Infection respiratoire', 'Diabète de type 2', 'Lombalgie commune', 'Carie dentaire', 'Gastrite', 'Grossesse normale', 'Syndrome grippal'];
const TYPES_VISITE = ['CONSULTATION_GENERALISTE', 'CONSULTATION_GENERALISTE', 'CONSULTATION_SPECIALISTE', 'ANALYSES_EXAMENS_MEDICAUX', 'HOSPITALISATION_MEDICALE', 'ACTES_DENTAIRES', 'PRESCRIPTION_MEDICALE'];

async function main() {
  const seulementNettoyage = process.argv.includes('--clean');
  console.log('Nettoyage du jeu de démonstration précédent…');
  await nettoyer();
  if (seulementNettoyage) { console.log('Terminé (nettoyage seul).'); return; }

  // modèles (lignes existantes copiées)
  const org = 'aaaaaaaa-0000-0000-0000-000000000001';
  const M = {
    entreprise: await modele('souscripteurs', "type='ENTREPRISE'"), collectivite: await modele('souscripteurs', "type='COLLECTIVITE'"),
    police: await modele('polices', "statut='ACTIVE'"), adherent: await modele('adherents'), beneficiaire: await modele('beneficiaires'),
    etab: await modele('etablissements_sante'), pharmacie: await modele('pharmacies'), dossier: await modele('dossiers_soins'),
    ticket: await modele('tickets_soins'), consultation: await modele('consultations_dossier'), acte: await modele('actes_dossier'),
    ordonnance: await modele('ordonnances'), ligneOrd: await modele('lignes_ordonnance'), dispensation: await modele('dispensations_pharmacie'),
    ligneDisp: await modele('lignes_dispensation'), cotisation: await modele('cotisations'), contestation: await modele('contestations_acte'),
    reclamation: await modele('reclamations'), remboursement: await modele('remboursements'),
    medecin: await modele('profils', "role='CENTRE_MEDICAL_MEDECIN'"), pharmacien: await modele('profils', "role='PHARMACIE_PHARMACIEN'"),
  };
  for (const [k, v] of Object.entries(M)) if (!v && !['contestation', 'reclamation', 'remboursement', 'collectivite'].includes(k)) throw new Error(`Modèle manquant : ${k}`);
  const idMedConseil = (await prisma.$queryRawUnsafe(`SELECT id::text FROM profils WHERE role='ASSUREUR_MEDECIN_CONSEIL' LIMIT 1`))[0].id;
  const idPharmConseil = (await prisma.$queryRawUnsafe(`SELECT id::text FROM profils WHERE role='ASSUREUR_PHARMACIEN_CONSEIL' LIMIT 1`))[0].id;
  const idExploitation = (await prisma.$queryRawUnsafe(`SELECT id::text FROM profils WHERE role='ASSUREUR_EXPLOITATION' LIMIT 1`))[0].id;
  const idInfo = (await prisma.$queryRawUnsafe(`SELECT id::text FROM profils WHERE role='ASSUREUR_INFORMATIQUE' LIMIT 1`))[0].id;
  const categoriesEtab = (await prisma.$queryRawUnsafe(`SELECT code::text FROM categories_etablissement`)).map((r) => r.code);
  const cim = (await prisma.$queryRawUnsafe(`SELECT code::text FROM maladies_cim10 WHERE code ~ '^[A-Z][0-9]{2}$' ORDER BY random() LIMIT 40`)).map((r) => r.code);
  const garanties = (await prisma.$queryRawUnsafe(`SELECT id::text FROM garanties`)).map((r) => r.id);
  const debutDonnees = new Date('2026-04-20T08:00:00Z');
  const aujourdhui = new Date('2026-10-17T12:00:00Z');

  console.log('Création des comptes de test (médecins, pharmaciens)…');
  const motDePasse = 'DemoRapports!2026';
  async function creerUtilisateur(email) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: motDePasse, email_confirm: true });
    if (error) throw error;
    return data.user.id;
  }

  // ---------- sociétés, polices, adhérents, bénéficiaires ----------
  const souscripteurs = [], polices = [], adherents = [], beneficiaires = [];
  SOCIETES.forEach(([nom, type, secteur, effectif], i) => {
    const modele = type === 'COLLECTIVITE' && M.collectivite ? M.collectivite : M.entreprise;
    souscripteurs.push({ ...modele, id: idDemo(`soc${i}`), organisation_id: org, type: modele.type, nom, secteur_activite: secteur, effectif_declare: effectif, statut: 'ACTIF', created_at: new Date(debutDonnees.getTime() - 60 * 86400000).toISOString(), updated_at: new Date().toISOString() });
    polices.push({ ...M.police, id: idDemo(`pol${i}`), organisation_id: org, souscripteur_id: idDemo(`soc${i}`), numero_police: `POL-DEMO-${pad(i + 1, 3)}`, date_debut: '2026-01-01T00:00:00Z', date_fin: '2026-12-31T00:00:00Z', statut: 'ACTIVE', created_at: '2026-01-01T08:00:00Z', updated_at: new Date().toISOString() });
  });
  let numAdh = 0, numCarte = 0;
  const parSociete = SOCIETES.map(() => []);
  SOCIETES.forEach((_, s) => {
    const n = entier(12, 18);
    for (let k = 0; k < n; k++) {
      const sexe = alea() < 0.5 ? 'M' : 'F';
      const id = idDemo(`adh${numAdh}`);
      adherents.push({ ...M.adherent, id, organisation_id: org, souscripteur_id: idDemo(`soc${s}`), police_id: idDemo(`pol${s}`), numero_adherent: `ADH-DEMO-${pad(++numAdh, 5)}`, nom: choix(NOMS), prenom: choix(sexe === 'M' ? PRENOMS_M : PRENOMS_F), date_naissance: `${entier(1965, 2000)}-${pad(entier(1, 12), 2)}-${pad(entier(1, 28), 2)}T00:00:00Z`, sexe, statut: pondere([['ACTIF', 92], ['SUSPENDU', 5], ['RADIE', 3]]), numero_carte: `CM-9${pad(++numCarte, 9)}`, email: null, telephone: `07${pad(entier(0, 99999999), 8)}`, photo_url: null, date_validation: '2026-01-15T10:00:00Z', valide_par_id: null, iban_ou_rib: null, banque_nom: null, statut_sortant_cible: null, motif_sortie: null, created_at: '2026-01-10T09:00:00Z', updated_at: new Date().toISOString() });
      parSociete[s].push(id);
    }
  });
  let numBen = 0;
  for (const a of adherents) {
    const nb = pondere([[0, 55], [1, 25], [2, 15], [3, 5]]);
    for (let b = 0; b < nb; b++) {
      const sexe = alea() < 0.5 ? 'M' : 'F';
      beneficiaires.push({ ...M.beneficiaire, id: idDemo(`ben${numBen}`), adherent_id: a.id, organisation_id: org, lien_parente: b === 0 && alea() < 0.5 ? 'CONJOINT' : 'ENFANT', nom: a.nom, prenom: choix(sexe === 'M' ? PRENOMS_M : PRENOMS_F), date_naissance: `${entier(2005, 2024)}-${pad(entier(1, 12), 2)}-${pad(entier(1, 28), 2)}T00:00:00Z`, sexe, numero_carte: `CM-8${pad(++numBen, 9)}`, statut: 'ACTIF', photo_url: null, created_at: '2026-02-01T09:00:00Z', updated_at: new Date().toISOString() });
    }
  }
  await inserer('souscripteurs', souscripteurs); await inserer('polices', polices);
  await inserer('adherents', adherents); await inserer('beneficiaires', beneficiaires);

  // ---------- établissements, pharmacies, personnel ----------
  const etabs = [], pharmacies = [];
  ETABLISSEMENTS.forEach(([nom, type, commune, lat, lon], i) => etabs.push({ ...M.etab, id: idDemo(`etab${i}`), organisation_id: org, nom, code: `DE${pad(i + 1, 2)}`, type_etablissement: type, commune, ville: 'Abidjan', latitude: lat, longitude: lon, statut: 'ACTIF', categorie_etablissement: choix(categoriesEtab), tiers_payant: true, created_at: '2026-01-05T09:00:00Z', updated_at: new Date().toISOString() }));
  PHARMACIES.forEach(([nom, commune], i) => pharmacies.push({ ...M.pharmacie, id: idDemo(`ph${i}`), organisation_id: org, nom, code: `DP${pad(i + 1, 2)}`, commune, ville: 'Abidjan', statut: 'ACTIVE', created_at: '2026-01-05T09:00:00Z', updated_at: new Date().toISOString() }));
  await inserer('etablissements_sante', etabs); await inserer('pharmacies', pharmacies);

  const medecinsParEtab = {}, profils = [];
  for (let i = 0; i < etabs.length; i++) {
    const uid = await creerUtilisateur(`armelk01+demo-med${i + 1}@gmail.com`);
    medecinsParEtab[etabs[i].id] = uid;
    profils.push({ ...M.medecin, id: uid, organisation_id: org, etablissement_id: etabs[i].id, numero_ordre_medecin: `DEMO-OM-${pad(i + 1, 3)}`, pseudo: null, photo_url: null, created_at: '2026-01-06T09:00:00Z', updated_at: new Date().toISOString() });
  }
  const pharmacienParPharmacie = {};
  for (let i = 0; i < pharmacies.length; i++) {
    const uid = await creerUtilisateur(`armelk01+demo-pharm${i + 1}@gmail.com`);
    pharmacienParPharmacie[pharmacies[i].id] = uid;
    profils.push({ ...M.pharmacien, id: uid, organisation_id: org, pharmacie_id: pharmacies[i].id, pseudo: null, photo_url: null, created_at: '2026-01-06T09:00:00Z', updated_at: new Date().toISOString() });
  }
  await inserer('profils', profils);
  const toutesPharmacies = [...pharmacies.map((p) => p.id), M.pharmacie.id];
  pharmacienParPharmacie[M.pharmacie.id] = M.pharmacien.id;
  const toutesEtabs = etabs.map((e) => e.id);

  // ---------- dossiers de soins ----------
  const dossiers = [], tickets = [], consultations = [], actes = [], ordonnances = [], lignesOrd = [], dispensations = [], lignesDisp = [];
  const patients = [...adherents.map((a) => ({ adherent: a, benef: null })), ...beneficiaires.map((b) => ({ adherent: adherents.find((a) => a.id === b.adherent_id), benef: b }))];
  const ouvertsParPatient = new Set();
  const nbDossiers = 260;
  const infos = []; // renseignements pour les étapes suivantes
  for (let i = 0; i < nbDossiers; i++) {
    const p = pondere([[patients.slice(0, adherents.length), 70], [patients.slice(adherents.length), 30]]);
    const pat = choix(p);
    const patientCle = pat.benef ? pat.benef.id : pat.adherent.id;
    // plus de dossiers récents (croissance de l'activité)
    const ouverture = new Date(debutDonnees.getTime() + Math.pow(alea(), 0.75) * (aujourdhui.getTime() - debutDonnees.getTime()));
    const recent = aujourdhui.getTime() - ouverture.getTime() < 6 * 86400000;
    const ouvert = recent && !ouvertsParPatient.has(patientCle) && alea() < 0.8;
    if (ouvert) ouvertsParPatient.add(patientCle);
    const etabId = choix(toutesEtabs);
    const dossierId = idDemo(`dos${i}`), ticketId = idDemo(`tic${i}`);
    const statut = ouvert ? 'OUVERT' : pondere([['CLOTURE', 94], ['FORCE_CLOS', 3], ['SUSPENDU', 3]]);
    const cloture = ouvert || statut === 'SUSPENDU' ? null : ajouteHeures(ouverture, entier(2, 72));
    dossiers.push({ ...M.dossier, id: dossierId, organisation_id: org, numero_traitement: `TRT-DEMO-${pad(i + 1, 6)}`, adherent_id: pat.benef ? null : pat.adherent.id, beneficiaire_id: pat.benef ? pat.benef.id : null, etablissement_id: etabId, police_id: pat.adherent.police_id, statut, type_visite: choix(TYPES_VISITE), date_ouverture: ouverture.toISOString(), date_cloture: cloture ? cloture.toISOString() : null, motif_consultation: choix(MOTIFS), diagnostic_entree: null, code_cim10: null, cloture_par: null, cloture_motif: statut === 'FORCE_CLOS' ? 'Clôture forcée par l’exploitation (démonstration)' : null, cloture_type: statut === 'CLOTURE' ? 'NORMALE' : statut === 'FORCE_CLOS' ? 'FORCEE' : null, transfere_vers: null, dossier_origine: null, created_at: ouverture.toISOString(), updated_at: (cloture || ouverture).toISOString(), deleted_at: null });
    const termine = !!cloture;
    tickets.push({ ...M.ticket, id: ticketId, dossier_soins_id: dossierId, organisation_id: org, code: codeAlea(), date_emission: ouverture.toISOString(), date_cloture: termine ? cloture.toISOString() : null, statut: termine ? 'CLOTURE' : 'OUVERT', created_at: ouverture.toISOString() });
    const medecinId = medecinsParEtab[etabId];
    // consultations
    const nbCons = pondere([[1, 75], [2, 20], [3, 5]]);
    const consIds = [];
    for (let c = 0; c < nbCons; c++) {
      const cid = idDemo(`con${i}_${c}`); consIds.push(cid);
      const dc = ajouteHeures(ouverture, c * 5 + 0.2);
      consultations.push({ ...M.consultation, id: cid, numero_consultation: `CST-DEMO-${pad(consultations.length + 1, 6)}`, dossier_soins_id: dossierId, medecin_id: medecinId, date_consultation: dc.toISOString(), motif: choix(MOTIFS), observations: 'Examen clinique réalisé (données de démonstration).', diagnostic: choix(DIAGNOSTICS), code_cim10: choix(cim), statut: termine || c < nbCons - 1 ? 'TERMINEE' : 'EN_COURS', organisation_id: org, created_at: dc.toISOString(), updated_at: dc.toISOString() });
    }
    // actes
    const nbActes = pondere([[1, 30], [2, 30], [3, 22], [4, 12], [5, 6]]);
    const idsActes = [];
    for (let a = 0; a < nbActes; a++) {
      const [categorie, libelle, codeActe, pmin, pmax] = a === 0 && alea() < 0.7 ? ACTES[alea() < 0.8 ? 0 : 1] : choix(ACTES);
      const quantite = categorie === 'HOSPITALISATION' ? entier(1, 6) : categorie === 'SOINS_INFIRMIERS' ? entier(1, 4) : 1;
      const prix = Math.round(entier(pmin, pmax) / 100) * 100;
      const cout = prix * quantite;
      const joursDepuis = (aujourdhui.getTime() - ouverture.getTime()) / 86400000;
      const requis = CATEGORIES_PREAUTH.has(categorie) || cout > 100000 || (joursDepuis < 15 && alea() < 0.3);
      let preauth = 'NON_REQUISE';
      if (requis) preauth = joursDepuis < 12 && alea() < 0.75 ? pondere([['EN_ATTENTE_EXPLOITATION', 50], ['EN_ATTENTE_MEDECIN_CONSEIL', 50]]) : pondere([['APPROUVEE', 62], ['APPROUVEE_PARTIELLEMENT', 14], ['REFUSEE', 24]]);
      if (!requis && alea() < 0.04) preauth = 'REFUSEE';
      const taux = TAUX[categorie] ?? 0.7;
      const assurance = arrondi(cout * taux), patient = cout - assurance;
      const refuse = preauth === 'REFUSEE', enAttente = preauth.startsWith('EN_ATTENTE');
      const realise = !refuse && !enAttente && (termine || alea() < 0.5);
      const datePresc = ajouteHeures(ouverture, a * 0.4 + 0.3);
      const acteId = idDemo(`act${i}_${a}`);
      const medecinReal = medecinId;
      actes.push({ ...M.acte, id: acteId, dossier_soins_id: dossierId, ticket_soins_id: ticketId, consultation_id: consIds[0], medecin_prescripteur_id: medecinId, categorie_acte: categorie, libelle, code_acte: codeActe, quantite, montant_prescrit: prix, statut: refuse ? 'ANNULE' : realise ? 'REALISE' : 'PRESCRIT', date_prescription: datePresc.toISOString(), date_realisation: realise ? ajouteHeures(datePresc, entier(1, 20)).toISOString() : null, created_at: datePresc.toISOString(), updated_at: datePresc.toISOString(), deleted_at: null, montant_simule_assurance: assurance, montant_simule_patient: patient, ticket_moderateur_simule: patient, statut_preautorisation: preauth, quantite_approuvee: preauth === 'APPROUVEE_PARTIELLEMENT' ? Math.max(1, Math.floor(quantite / 2)) : null, type_acte_approuve: null, ticket_moderateur_ajuste: null, etablissement_execution_id: realise ? etabId : null, tarif_conventionne_id: null, referentiel_acte_id: null, medecin_realisateur_id: realise ? medecinReal : null, realisation_declaree_par: null, origine_montant: 'SAISI', organisation_id: org });
      idsActes.push({ id: acteId, cout, assurance, patient, realise, refuse, enAttente, categorie, datePresc });
    }
    // ordonnance
    let ord = null;
    if (alea() < 0.5 && !ouvert) {
      const ordId = idDemo(`ord${i}`);
      const dateOrd = ajouteHeures(ouverture, 1);
      const nbL = pondere([[1, 40], [2, 40], [3, 20]]);
      const lignes = [];
      for (let l = 0; l < nbL; l++) { const m = choix(MEDICAMENTS); lignes.push({ id: idDemo(`lor${i}_${l}`), m, qte: entier(1, 3) }); }
      ord = { id: ordId, dateOrd, lignes };
      ordonnances.push({ ...M.ordonnance, id: ordId, organisation_id: org, dossier_soins_id: dossierId, consultation_id: consIds[0], medecin_id: medecinId, lignes: [], statut: 'ACTIVE', date_prescription: dateOrd.toISOString(), date_validite: ajouteJours(dateOrd, 14).toISOString(), created_at: dateOrd.toISOString(), updated_at: dateOrd.toISOString() });
      // dispensation
      const dispense = alea() < 0.75;
      const pharmId = choix(toutesPharmacies);
      const statDisp = dispense ? pondere([['PAYEE', 78], ['VALIDEE', 6], ['EN_ATTENTE_VALIDATION_PATIENT', 6], ['ANNULEE', 6], ['EN_PREPARATION', 4]]) : null;
      const joursOrd = (aujourdhui.getTime() - dateOrd.getTime()) / 86400000;
      const lignesPay = [];
      let totalDisp = 0;
      lignes.forEach((lg, idx) => {
        const prixU = Math.round(lg.m[1] * (0.95 + alea() * 0.12));
        const montant = prixU * lg.qte, assu = arrondi(montant * 0.8);
        totalDisp += montant;
        lignesPay.push({ lg, prixU, montant, assu });
      });
      const dispId = idDemo(`dis${i}`);
      const servi = statDisp === 'PAYEE';
      lignes.forEach((lg, idx) => lignesOrd.push({ ...M.ligneOrd, id: lg.id, ordonnance_id: ordId, organisation_id: org, denomination_medicament: lg.m[0], posologie: lg.m[2], duree: lg.m[3], dosage: null, quantite_prescrite: lg.qte, statut: servi ? 'SERVIE' : 'DISPONIBLE', pharmacie_servante_id: servi ? pharmId : null, quantite_servie: servi ? lg.qte : null, created_at: dateOrd.toISOString(), updated_at: dateOrd.toISOString() }));
      if (dispense) {
        const codeD = codeAlea();
        const datePrep = ajouteHeures(dateOrd, entier(2, 30));
        const valide = ['VALIDEE', 'PAYEE'].includes(statDisp);
        const expire = statDisp === 'EN_ATTENTE_VALIDATION_PATIENT' ? (joursOrd < 1 ? ajouteHeures(aujourdhui, 2) : ajouteHeures(datePrep, 2)) : null;
        dispensations.push({ ...M.dispensation, id: dispId, organisation_id: org, ordonnance_id: ordId, pharmacie_id: pharmId, caissiere_id: pharmacienParPharmacie[pharmId], montant_total: totalDisp, statut: statDisp, code_confirmation: empreinteCode(codeD), code_confirmation_chiffre: chiffrerCode(codeD), code_confirmation_expire_le: expire ? expire.toISOString() : null, date_preparation: datePrep.toISOString(), date_validation_patient: valide ? ajouteHeures(datePrep, 0.4).toISOString() : null, date_paiement: statDisp === 'PAYEE' ? ajouteHeures(datePrep, 0.7).toISOString() : null, created_at: datePrep.toISOString() });
        lignesPay.forEach((x, idx) => lignesDisp.push({ ...M.ligneDisp, id: idDemo(`ldi${i}_${idx}`), dispensation_id: dispId, ligne_ordonnance_id: x.lg.id, organisation_id: org, prix_unitaire: x.prixU, quantite: x.lg.qte, montant_ligne: x.montant, montant_assurance: x.assu, montant_patient: x.montant - x.assu, reportee_mois_suivant: false, prix_reference: x.lg.m[1], majoration_pourcent: Math.round(((x.prixU - x.lg.m[1]) / x.lg.m[1]) * 1000) / 10, majoration_anormale: x.prixU > x.lg.m[1] * 1.1 }));
        if (statDisp === 'PAYEE') ordonnances[ordonnances.length - 1].statut = 'COMPLETEMENT_DELIVREE';
        else if (joursOrd > 14) ordonnances[ordonnances.length - 1].statut = 'EXPIREE';
        infos.push({ type: 'disp', dispId, pharmId, statut: statDisp, total: totalDisp, assu: lignesPay.reduce((s, x) => s + x.assu, 0), date: datePrep });
      } else if (joursOrd > 14) ordonnances[ordonnances.length - 1].statut = 'EXPIREE';
    }
    infos.push({ type: 'dossier', dossierId, ticketId, etabId, ouverture, cloture, statut, pat, actes: idsActes, medecinId });
  }
  await basculerTriggers('DISABLE');
  try {
    console.log('Insertion des dossiers, consultations, actes, ordonnances…');
    await inserer('dossiers_soins', dossiers); await inserer('tickets_soins', tickets);
    await inserer('consultations_dossier', consultations); await inserer('actes_dossier', actes);
    await inserer('ordonnances', ordonnances); await inserer('lignes_ordonnance', lignesOrd);
    await inserer('dispensations_pharmacie', dispensations); await inserer('lignes_dispensation', lignesDisp);

    // ---------- factures par dossier + lignes de facturation + factures mensuelles ----------
    console.log('Facturation (dossiers, mensuelle établissement et pharmacie)…');
    const facturesDossier = [], lignesFact = [], mensuellesEtab = new Map(), mensuellesPharm = new Map();
    const moisCourant = '2026-10';
    for (const d of infos.filter((x) => x.type === 'dossier')) {
      const facturables = d.actes.filter((a) => a.realise);
      if (!d.cloture || !facturables.length || alea() < 0.12) continue;
      const mois = jour(d.cloture).slice(0, 7);
      const total = facturables.reduce((s, a) => s + a.cout, 0), assu = facturables.reduce((s, a) => s + a.assurance, 0);
      const statutF = mois <= '2026-07' ? pondere([['REGLEE', 85], ['CONTESTEE', 15]]) : mois === '2026-08' ? pondere([['REGLEE', 55], ['VALIDEE', 45]]) : mois === '2026-09' ? pondere([['VALIDEE', 50], ['EMISE', 30], ['EN_VALIDATION', 20]]) : pondere([['EMISE', 40], ['EN_VALIDATION', 25], ['VALIDEE', 35]]);
      const valide = ['VALIDEE', 'REGLEE'].includes(statutF) || (statutF === 'CONTESTEE');
      const code = codeAlea(), facId = idDemo(`fac${d.dossierId}`);
      const dateEmission = ajouteHeures(d.cloture, 1);
      const expire = valide ? null : mois === moisCourant ? ajouteHeures(aujourdhui, 10) : ajouteHeures(dateEmission, 24);
      facturesDossier.push({ id: facId, organisation_id: org, dossier_soins_id: d.dossierId, ticket_soins_id: d.ticketId, etablissement_id: d.etabId, adherent_id: d.pat.benef ? null : d.pat.adherent.id, beneficiaire_id: d.pat.benef ? d.pat.benef.id : null, montant_total: total, montant_assurance: assu, montant_patient: total - assu, statut: statutF, code_facturation: empreinteCode(code), code_facturation_chiffre: chiffrerCode(code), code_facturation_expire_le: expire ? expire.toISOString() : null, code_valide_par_patient: valide, date_validation_patient: valide ? ajouteHeures(dateEmission, 3).toISOString() : null, date_reglement: statutF === 'REGLEE' ? ajouteJours(dateEmission, entier(10, 40)).toISOString() : null, regle_par: statutF === 'REGLEE' ? idInfo : null, tarif_propose_id: null, created_at: dateEmission.toISOString(), updated_at: dateEmission.toISOString(), deleted_at: null });
      const cleM = `${d.etabId}|${mois}`;
      const reporter = mois !== moisCourant;
      if (reporter && !mensuellesEtab.has(cleM)) mensuellesEtab.set(cleM, { id: idDemo(`fme${cleM}`), etabId: d.etabId, mois, total: 0 });
      const payee = mois <= '2026-07';
      facturables.forEach((a, idx) => {
        if (reporter) mensuellesEtab.get(cleM).total += a.assurance;
        lignesFact.push({ id: idDemo(`lfa${a.id}`), organisation_id: org, facture_dossier_id: facId, acte_dossier_id: a.id, montant_reclame: a.assurance, statut: payee ? 'PAYE' : 'A_PAYER', date_paiement: payee ? `${mois}-28T10:00:00Z` : null, created_at: dateEmission.toISOString(), facture_mensuelle_etablissement_id: reporter ? mensuellesEtab.get(cleM).id : null, reportee_mois_suivant: false, tarif_statut: null, tarif_regle_origine: null, tarif_lettre_cle: null, tarif_coefficient: null, tarif_valeur_appliquee: null, tarif_convention_id: null, tarif_politique_depassement: null, tarif_prix_affiche: null, tarif_reconnu: null, tarif_ecart: null, tarif_unitaire: null, tarif_quantite: null, tarif_provisoire: false, tarif_propose_id: null });
      });
    }
    const statutMensuel = (mois) => (mois <= '2026-07' ? 'PAYEE' : mois === '2026-08' ? pondere([['PARTIELLEMENT_REGLEE', 40], ['PAIEMENT_PROGRAMME', 35], ['PROGRAMMEE_PAIEMENT', 25]]) : pondere([['VERIFIEE_MEDECIN_CONSEIL', 50], ['SOUMISE', 50]]));
    const mensEtabLignes = [...mensuellesEtab.values()].map((m) => {
      const statut = statutMensuel(m.mois), dateSoum = `${m.mois}-28T09:00:00Z`;
      const soum = new Date(new Date(`${m.mois}-01T00:00:00Z`).setUTCMonth(new Date(`${m.mois}-01T00:00:00Z`).getUTCMonth() + 1, 2)).toISOString();
      return { id: m.id, organisation_id: org, etablissement_id: m.etabId, periode: `${m.mois}-01`, montant_total: m.total, statut, date_soumission: soum, verifie_par_id: statut === 'SOUMISE' ? null : idMedConseil, date_verification: statut === 'SOUMISE' ? null : ajouteJours(soum, 3).toISOString(), date_programmation: ['PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE', 'PAYEE'].includes(statut) ? ajouteJours(soum, 7).toISOString() : null, date_paiement: statut === 'PAYEE' ? ajouteJours(soum, 15).toISOString() : null, created_at: dateSoum, nb_lignes_reportees: 0, montant_paye: statut === 'PAYEE' ? m.total : statut === 'PARTIELLEMENT_REGLEE' ? arrondi(m.total * 0.5) : 0, paiement_programme_compte_id: null, paiement_programme_montant: null, paiement_programme_preuves: null, paiement_programme_date: null };
    });
    // pharmacie : factures mensuelles à partir des dispensations payées
    for (const x of infos.filter((i) => i.type === 'disp' && i.statut === 'PAYEE')) {
      const mois = jour(x.date).slice(0, 7); if (mois === moisCourant) continue;
      const k = `${x.pharmId}|${mois}`;
      const m = mensuellesPharm.get(k) || { id: idDemo(`fmp${k}`), pharmId: x.pharmId, mois, total: 0 };
      m.total += x.assu; mensuellesPharm.set(k, m);
    }
    const mensPharmLignes = [...mensuellesPharm.values()].map((m) => {
      const statut = m.mois <= '2026-07' ? 'PAYEE' : m.mois === '2026-08' ? pondere([['PARTIELLEMENT_REGLEE', 40], ['PAIEMENT_PROGRAMME', 60]]) : pondere([['VALIDEE_PHARMACIEN_CONSEIL', 50], ['SOUMISE', 50]]);
      const soum = new Date(new Date(`${m.mois}-01T00:00:00Z`).setUTCMonth(new Date(`${m.mois}-01T00:00:00Z`).getUTCMonth() + 1, 2)).toISOString();
      return { id: m.id, organisation_id: org, pharmacie_id: m.pharmId, periode: `${m.mois}-01`, montant_total: m.total, statut, date_soumission: soum, valide_par_id: statut === 'SOUMISE' ? null : idPharmConseil, date_validation: statut === 'SOUMISE' ? null : ajouteJours(soum, 3).toISOString(), date_programmation: ['PROGRAMMEE_PAIEMENT', 'PAIEMENT_PROGRAMME', 'PARTIELLEMENT_REGLEE', 'PAYEE'].includes(statut) ? ajouteJours(soum, 7).toISOString() : null, date_paiement: statut === 'PAYEE' ? ajouteJours(soum, 15).toISOString() : null, created_at: soum, nb_lignes_reportees: 0, montant_paye: statut === 'PAYEE' ? m.total : statut === 'PARTIELLEMENT_REGLEE' ? arrondi(m.total * 0.5) : 0, paiement_programme_compte_id: null, paiement_programme_montant: null, paiement_programme_preuves: null, paiement_programme_date: null };
    });
    await inserer('factures_mensuelles_etablissement', mensEtabLignes);
    await inserer('factures_mensuelles_pharmacie', mensPharmLignes);
    await inserer('factures_dossier', facturesDossier);
    await inserer('lignes_facturation', lignesFact);

    // ---------- cotisations ----------
    console.log('Cotisations, contestations, réclamations, comptes financiers…');
    const cotisations = [];
    SOCIETES.forEach(([, , , effectif], s) => {
      for (let m = 1; m <= 10; m++) {
        const periode = `2026-${pad(m, 2)}-01`, fin = new Date(Date.UTC(2026, m, 0)).toISOString().slice(0, 10);
        const du = parSociete[s].length * 4500 + entier(0, 15) * 1000;
        const statut = m <= 7 ? pondere([['PAYEE', 90], ['EN_RETARD', 10]]) : m === 8 ? pondere([['PAYEE', 60], ['EN_RETARD', 40]]) : m === 9 ? pondere([['PAYEE', 35], ['A_PAYER', 35], ['EN_RETARD', 30]]) : 'A_PAYER';
        cotisations.push({ ...M.cotisation, id: idDemo(`cot${s}_${m}`), organisation_id: org, police_id: idDemo(`pol${s}`), adherent_id: null, societe_id: idDemo(`soc${s}`), periode, montant_du: du, montant_paye: statut === 'PAYEE' ? du : 0, date_echeance: fin, statut, penalite_appliquee: statut === 'EN_RETARD' ? arrondi(du * 0.02) : 0, created_at: `${periode}T08:00:00Z`, updated_at: `${fin}T08:00:00Z`, deleted_at: null });
      }
    });
    await inserer('cotisations', cotisations);

    // ---------- contestations (médecin conseil) ----------
    const contestations = [];
    if (M.contestation) {
      const candidats = actes.filter((a) => a.statut === 'REALISE' || a.statut === 'ANNULE').slice(0, 400);
      const nombre = Math.min(18, candidats.length);
      for (let k = 0; k < nombre; k++) {
        const a = candidats[Math.floor((k + 0.5) * candidats.length / nombre)];
        const statut = pondere([['OUVERT', 25], ['JUSTIFICATION_RECUE', 20], ['VALIDEE', 30], ['REJETEE', 25]]);
        const ouv = new Date(a.date_prescription), clos = statut === 'VALIDEE' || statut === 'REJETEE';
        contestations.push({ ...M.contestation, id: idDemo(`cta${k}`), organisation_id: org, acte_dossier_id: a.id, ouvert_par_id: idMedConseil, motif: choix(['Acte non justifié par le diagnostic', 'Quantité facturée supérieure à la prescription', 'Tarif supérieur à la convention', 'Doublon avec un acte précédent']), date_ouverture: ajouteJours(ouv, 5).toISOString(), date_limite: ajouteJours(ouv, 12).toISOString(), statut, reponse_etablissement: statut === 'OUVERT' ? null : 'Justification transmise par l’établissement (démonstration).', pieces_justificatives: null, traite_par_id: clos ? idMedConseil : null, date_cloture: clos ? ajouteJours(ouv, 9).toISOString() : null, created_at: ajouteJours(ouv, 5).toISOString(), updated_at: ajouteJours(ouv, 9).toISOString() });
      }
    }
    await inserer('contestations_acte', contestations);

    // ---------- réclamations + remboursements ----------
    const reclamations = [], rembours = [];
    if (M.reclamation) {
      const realises = actes.filter((a) => a.statut === 'REALISE');
      const nombre = Math.min(60, realises.length);
      for (let k = 0; k < nombre; k++) {
        const a = realises[Math.floor((k + 0.5) * realises.length / nombre)];
        const dossier = dossiers.find((d) => d.id === a.dossier_soins_id);
        const statut = pondere([['PAYEE', 50], ['AUTO_ADJUDIQUE', 15], ['REVUE_MANUELLE', 12], ['REJETE', 13], ['SOUMISE', 10]]);
        const recId = idDemo(`rec${k}`);
        reclamations.push({ ...M.reclamation, id: recId, organisation_id: org, dossier_soins_id: a.dossier_soins_id, acte_dossier_id: a.id, adherent_id: dossier.adherent_id, beneficiaire_id: dossier.beneficiaire_id, police_id: dossier.police_id, garantie_id: choix(garanties), montant: a.montant_simule_assurance, type_reclamation: choix(['SOIN', 'ANALYSES', 'IMAGERIE', 'DENTAIRE', 'HOSPITALISATION']), statut, codes_rejet: statut === 'REJETE' ? ['E012'] : [], created_at: a.date_prescription, updated_at: a.date_prescription, deleted_at: null, dispensation_id: null });
        if (statut === 'PAYEE' && M.remboursement) rembours.push({ ...M.remboursement, id: idDemo(`rem${k}`), reclamation_id: recId, organisation_id: org, montant_rembourse: a.montant_simule_assurance, plafond_restant_apres: entier(200000, 2000000), created_at: a.date_prescription, duree_traitement_ms: entier(800, 6000) });
      }
    }
    await inserer('reclamations', reclamations);
    await inserer('remboursements', rembours);

    // ---------- comptes financiers + mouvements (comptable) ----------
    const comptes = [
      ['BANCAIRE', 'Compte principal SIB', 'Société Ivoirienne de Banque', 'CI93 CI08 0100 1234 5678', 180000000], ['BANCAIRE', 'Compte prestataires NSIA', 'NSIA Banque', 'CI93 CI13 0200 8765 4321', 95000000],
      ['CAISSE_INTERNE', 'Caisse interne siège', null, null, 3500000],
    ].map(([type, nom, banque, num, solde], i) => ({ id: idDemo(`cpt${i}`), organisation_id: org, type, nom, banque_nom: banque, numero_compte: num, solde_actuel: solde, cree_par: idInfo, created_at: '2026-01-10T09:00:00Z', updated_at: new Date().toISOString(), deleted_at: null, statut: 'ACTIF' }));
    const mouvements = [];
    for (let k = 0; k < 40; k++) {
      const type = pondere([['APPROVISIONNEMENT', 25], ['DEPENSE', 25], ['TRANSFERT', 15], ['PAIEMENT_FACTURE', 35]]);
      const date = new Date(debutDonnees.getTime() + alea() * (aujourdhui.getTime() - debutDonnees.getTime()));
      const src = choix(comptes), dst = choix(comptes.filter((c) => c.id !== src.id));
      mouvements.push({ id: idDemo(`mvt${k}`), organisation_id: org, compte_source_id: type === 'APPROVISIONNEMENT' ? null : src.id, compte_destination_id: type === 'TRANSFERT' ? dst.id : type === 'APPROVISIONNEMENT' ? dst.id : null, type, montant: Math.round(entier(150000, 12000000) / 1000) * 1000, description: type === 'APPROVISIONNEMENT' ? 'Approvisionnement du compte (cotisations encaissées)' : type === 'DEPENSE' ? choix(['Frais de fonctionnement', 'Fournitures de bureau', 'Prestations informatiques', 'Loyer du siège']) : type === 'TRANSFERT' ? 'Transfert entre comptes' : choix(['Règlement facture mensuelle établissement', 'Règlement facture mensuelle pharmacie']), piece_jointe_url: null, effectue_par: idInfo, created_at: date.toISOString() });
    }
    await inserer('comptes_financiers', comptes);
    await inserer('mouvements_financiers', mouvements);
  } finally {
    await basculerTriggers('ENABLE');
  }
  console.log('\nJeu de démonstration créé :');
  for (const [t, n] of Object.entries(tables)) console.log(`  ${t.padEnd(36)} ${n}`);
  console.log(`\nComptes de test : armelk01+demo-med1..${etabs.length}@gmail.com (médecins), armelk01+demo-pharm1..${pharmacies.length}@gmail.com (pharmaciens) — mot de passe ${motDePasse}`);
}

main()
  .catch(async (e) => { console.error('\nÉCHEC :', e.message); try { await basculerTriggers('ENABLE'); } catch {} process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
