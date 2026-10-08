/**
 * Intégration — deux factures tiers payant RÉELLEMENT simultanées ne doivent jamais
 * dépasser ensemble un plafond annuel (verrou `pg_advisory_xact_lock`, ADR-005 /
 * ADR-006 : par personne, ou par famille si le produit a un plafond famille).
 *
 * Appelle l'API réelle (`INTEGRATION_API_URL`, défaut http://localhost:3001/api/v1)
 * et donc le microservice d'adjudication ; crée ses données dans une organisation
 * dédiée et les supprime dans l'ordre inverse des dépendances, puis vérifie qu'il ne
 * reste aucune ligne. Sans le verrou, ce test ÉCHOUE (vérifié : chaque facture prend
 * alors la totalité de son montant). À lancer avant chaque déploiement.
 */
import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../web/.env.local') });

const API = process.env.INTEGRATION_API_URL ?? 'http://localhost:3001/api/v1';
const CLE_PUBLIQUE =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

const prisma = new PrismaClient();
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ts = Date.now();
const MDP = `Int-${randomUUID()}!`;
const orgId = randomUUID();
const comptes: string[] = [];

interface Session {
  id: string;
  jeton: string;
}

async function utilisateur(tag: string, profil: Record<string, unknown>): Promise<Session> {
  const email = `integration+${tag}${ts}@assurance-sante.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: MDP, email_confirm: true });
  if (error) throw error;
  comptes.push(data.user.id);
  await prisma.profil.create({ data: { id: data.user.id, organisationId: orgId, ...profil } as never });
  const client = createClient(process.env.SUPABASE_URL!, CLE_PUBLIQUE, { auth: { persistSession: false } });
  const { data: s, error: e } = await client.auth.signInWithPassword({ email, password: MDP });
  if (e || !s.session) throw e ?? new Error('connexion impossible');
  return { id: data.user.id, jeton: s.session.access_token };
}

async function appel(u: Session, methode: string, chemin: string, corps?: unknown) {
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${u.jeton}`, 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

/** Suppression dans l'ordre INVERSE des dépendances. */
async function nettoyer() {
  const o = { organisationId: orgId };
  await prisma.ligneFacturation.deleteMany({ where: o });
  await prisma.factureDossier.deleteMany({ where: o });
  await prisma.acteDossier.deleteMany({ where: { dossier: o } });
  await prisma.consultationDossier.deleteMany({ where: { dossier: o } });
  await prisma.ticketSoins.deleteMany({ where: o });
  await prisma.dossierSoins.deleteMany({ where: o });
  await prisma.profil.deleteMany({ where: { id: { in: comptes } } });
  await prisma.beneficiaire.deleteMany({ where: { adherent: o } });
  await prisma.adherent.deleteMany({ where: o });
  await prisma.police.deleteMany({ where: o });
  await prisma.garantie.deleteMany({ where: { produit: o } });
  await prisma.produit.deleteMany({ where: o });
  await prisma.etablissementSante.deleteMany({ where: o });
  await prisma.souscripteur.deleteMany({ where: o });
  await prisma.organisation.deleteMany({ where: { id: orgId } });
  for (const id of comptes) await admin.auth.admin.deleteUser(id);
}

describe('Factures simultanées et plafond annuel (verrou)', () => {
  let med: Session;
  let cpt: Session;
  let etabId: string;
  let souscripteurId: string;

  beforeAll(async () => {
    if (!CLE_PUBLIQUE) throw new Error('Clé publique Supabase absente (SUPABASE_PUBLISHABLE_KEY ou apps/web/.env.local).');
    const sante = await fetch(`${API}/sante`).catch(() => null);
    const corps = sante ? ((await sante.json().catch(() => null)) as any) : null;
    if (sante?.status !== 200 || corps?.statut !== 'UP') {
      throw new Error(
        `Plateforme non prête (${API}/sante → ${sante?.status ?? 'injoignable'}) : démarrez l'API et le microservice d'adjudication.`,
      );
    }
    await prisma.organisation.create({ data: { id: orgId, nom: `Intégration verrou ${ts}`, type: 'ASSUREUR', pays: 'CI', slug: `integration-verrou-${ts}` } });
    souscripteurId = (await prisma.souscripteur.create({ data: { organisationId: orgId, type: 'ENTREPRISE', nom: `Société ${ts}` } })).id;
    etabId = (await prisma.etablissementSante.create({ data: { organisationId: orgId, nom: `Clinique ${ts}`, code: `INT-${ts}`, typeEtablissement: 'CLINIQUE_PRIVEE', statut: 'ACTIF' } })).id;
    med = await utilisateur('med', { role: 'CENTRE_MEDICAL_MEDECIN', etablissementId: etabId });
    cpt = await utilisateur('cpt', { role: 'CENTRE_MEDICAL_COMPTABLE', etablissementId: etabId });
  });

  afterAll(async () => {
    try {
      await nettoyer();
      const o = { organisationId: orgId };
      const restants = await Promise.all([
        prisma.ligneFacturation.count({ where: o }),
        prisma.factureDossier.count({ where: o }),
        prisma.acteDossier.count({ where: { dossier: o } }),
        prisma.dossierSoins.count({ where: o }),
        prisma.beneficiaire.count({ where: { adherent: o } }),
        prisma.adherent.count({ where: o }),
        prisma.police.count({ where: o }),
        prisma.garantie.count({ where: { produit: o } }),
        prisma.produit.count({ where: o }),
        prisma.profil.count({ where: { id: { in: comptes } } }),
        prisma.organisation.count({ where: { id: orgId } }),
      ]);
      let authRestants = 0;
      for (const id of comptes) if ((await admin.auth.admin.getUserById(id)).data?.user) authRestants++;
      expect(restants).toEqual(restants.map(() => 0));
      expect(authRestants).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  /** Produit publié CONSULTATION 100 % + police active ; plafonds au choix. */
  async function contrat(plafonds: { personne?: string; famille?: string }) {
    const produit = await prisma.produit.create({
      data: { organisationId: orgId, nom: `Formule ${randomUUID().slice(0, 8)}`, statut: 'PUBLIE', datePublication: new Date(), periodeCumulPlafond: 'ANNEE_CIVILE' },
    });
    await prisma.garantie.create({
      data: { produitId: produit.id, categorieActe: 'CONSULTATION', tauxCouverture: '100', plafondAnnuelPersonne: plafonds.personne ?? null, plafondAnnuelFamille: plafonds.famille ?? null },
    });
    return prisma.police.create({ data: { organisationId: orgId, souscripteurId, produitId: produit.id, statut: 'ACTIVE', dateDebut: new Date('2020-01-01') } });
  }

  /** Dossier ouvert d'une personne, avec `n` consultations RÉALISÉES de `montant`. */
  async function dossierAvecActes(
    personne: { adherentId?: string; beneficiaireId?: string },
    policeId: string,
    n: number,
    montant: number,
  ) {
    const dossier = await prisma.dossierSoins.create({
      data: { organisationId: orgId, etablissementId: etabId, policeId, adherentId: personne.adherentId ?? null, beneficiaireId: personne.beneficiaireId ?? null, statut: 'OUVERT' },
    });
    const ticket = await prisma.ticketSoins.create({
      data: { organisationId: orgId, dossierSoinsId: dossier.id, code: `I${String(randomInt(10_000_000)).padStart(7, '0')}` },
    });
    const consultation = await prisma.consultationDossier.create({ data: { dossierSoinsId: dossier.id, medecinId: med.id } });
    const actes: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = await appel(med, 'POST', `/preauthorization/tickets-soins/${ticket.id}/actes`, {
        categorieActe: 'CONSULTATION', libelle: `Consultation ${i + 1}`, consultationId: consultation.id, montantPrescrit: montant,
      });
      expect(a.status).toBe(201);
      const r = await appel(med, 'POST', `/preauthorization/actes/${a.body.id}/realiser`, {});
      expect([200, 201]).toContain(r.status);
      actes.push(a.body.id);
    }
    return { dossierId: dossier.id, actes };
  }

  /** Lance les factures EN MÊME TEMPS et renvoie les parts assurance, triées décroissantes. */
  async function facturesSimultanees(demandes: { dossierId: string; acteIds: string[] }[]) {
    const reponses = await Promise.all(
      demandes.map((d) => appel(cpt, 'POST', `/preauthorization/dossiers/${d.dossierId}/facture-selection`, { acteIds: d.acteIds })),
    );
    for (const r of reponses) expect(r.status).toBe(201);
    return reponses.map((r) => Number(r.body.montantAssurance)).sort((a, b) => b - a);
  }

  it('plafond PERSONNE (30 000) : deux factures simultanées de 20 000 pour le même adhérent → 20 000 + 10 000', async () => {
    const police = await contrat({ personne: '30000' });
    const adh = await prisma.adherent.create({
      data: { organisationId: orgId, souscripteurId, policeId: police.id, nom: 'INTEGRATION', prenom: 'Personne', dateNaissance: new Date('1980-01-01') },
    });
    const { dossierId, actes } = await dossierAvecActes({ adherentId: adh.id }, police.id, 4, 10000);

    const parts = await facturesSimultanees([
      { dossierId, acteIds: actes.slice(0, 2) },
      { dossierId, acteIds: actes.slice(2) },
    ]);

    // sans verrou : [20000, 20000] — 40 000 pris en charge pour un plafond de 30 000
    expect(parts).toEqual([20000, 10000]);
  });

  it('plafond FAMILLE (30 000) : deux bénéficiaires facturés simultanément (20 000 chacun) → 20 000 + 10 000', async () => {
    const police = await contrat({ famille: '30000' });
    const titulaire = await prisma.adherent.create({
      data: { organisationId: orgId, souscripteurId, policeId: police.id, nom: 'INTEGRATION', prenom: 'Famille', dateNaissance: new Date('1980-01-01') },
    });
    const enfant = (prenom: string) =>
      prisma.beneficiaire.create({
        data: { adherentId: titulaire.id, lienParente: 'ENFANT', nom: 'INTEGRATION', prenom, dateNaissance: new Date('2015-01-01'), sexe: 'M' },
      });
    const [b1, b2] = await Promise.all([enfant('Un'), enfant('Deux')]);
    const d1 = await dossierAvecActes({ beneficiaireId: b1.id }, police.id, 1, 20000);
    const d2 = await dossierAvecActes({ beneficiaireId: b2.id }, police.id, 1, 20000);

    const parts = await facturesSimultanees([
      { dossierId: d1.dossierId, acteIds: d1.actes },
      { dossierId: d2.dossierId, acteIds: d2.actes },
    ]);

    // sans verrou famille : [20000, 20000] — 40 000 pour un plafond familial de 30 000
    expect(parts).toEqual([20000, 10000]);
  });
});
