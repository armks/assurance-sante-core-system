/**
 * Intégration — état de la base APRÈS toutes les migrations (ADR-008, lot 5).
 *
 * Plusieurs migrations redéfinissent la même fonction (`CREATE OR REPLACE`) : rejouer une ancienne migration après une
 * récente la ramène à une version obsolète (constaté au lot 4 : rejouer 082 après 083 retirait l'exception de la trace
 * provisoire et faisait échouer la réintégration). Ce test vérifie que les fonctions et contraintes partagées sont dans
 * leur DERNIER état, et que l'ordre des fichiers SQL garde la dernière définition en dernier.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();
const DOSSIER_SQL = path.resolve(__dirname, '../../prisma/sql');

afterAll(async () => {
  await prisma.$disconnect();
});

async function definition(fonction: string): Promise<string> {
  const r = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = '${fonction}'`,
  );
  expect(r).toHaveLength(1);
  return r[0].def;
}

describe('état des fonctions et contraintes partagées après toutes les migrations', () => {
  it('lignes_facturation_tarif_fige : version de la migration 083 (trace provisoire remplaçable une fois, quantité et tarif proposé figés)', async () => {
    const def = await definition('lignes_facturation_tarif_fige');
    expect(def).toContain('OLD.tarif_provisoire = false');
    expect(def).toContain('NEW.tarif_unitaire');
    expect(def).toContain('NEW.tarif_quantite');
    expect(def).toContain('NEW.tarif_propose_id');
    expect(def).toContain("RAISE EXCEPTION 'Le tarif appliqué à une ligne de facturation est figé");
  });

  it('tarifs_proposes_fige : une proposition décidée ne se modifie plus', async () => {
    const def = await definition('tarifs_proposes_fige');
    expect(def).toContain("OLD.statut <> 'PROPOSE'");
    expect(def).toContain('OLD.montant_propose');
  });

  it('triggers attachés', async () => {
    const r = await prisma.$queryRawUnsafe<{ tgname: string }[]>(
      `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('lignes_facturation_tarif_fige', 'tarifs_proposes_fige')`,
    );
    expect(r.map((x) => x.tgname).sort()).toEqual(['lignes_facturation_tarif_fige', 'tarifs_proposes_fige']);
  });

  it('contraintes : règle d’origine TARIF_PROPOSE admise, non auto-décision, un seul tarif vivant par acte', async () => {
    const c = await prisma.$queryRawUnsafe<{ conname: string; def: string }[]>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('lignes_facturation_tarif_trace_valide', 'tarifs_proposes_pas_d_auto_decision', 'tarifs_proposes_ajout_convention_apres_decision')`,
    );
    const par = Object.fromEntries(c.map((x) => [x.conname, x.def]));
    expect(par['lignes_facturation_tarif_trace_valide']).toContain('TARIF_PROPOSE');
    expect(par['tarifs_proposes_pas_d_auto_decision']).toContain('decide_par <> propose_par');
    expect(par['tarifs_proposes_ajout_convention_apres_decision']).toContain("'VALIDE'");
    const i = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'tarifs_proposes_un_vivant_par_acte'`,
    );
    expect(i[0].indexdef).toContain("statut <> 'REFUSE'");
    expect(i[0].indexdef).toContain('deleted_at IS NULL');
  });

  it('paramètres de plateforme du lot 5 présents avec leurs valeurs par défaut', async () => {
    const p = await prisma.$queryRawUnsafe<{ cle: string; valeur: unknown }[]>(
      `SELECT cle, valeur FROM parametres_plateforme WHERE cle LIKE 'tarif_propose_%' ORDER BY cle`,
    );
    const m = Object.fromEntries(p.map((x) => [x.cle, Number(x.valeur)]));
    expect(m).toMatchObject({
      tarif_propose_alerte_ecart_mediane_pourcent: 50,
      tarif_propose_recurrence_nombre: 5,
      tarif_propose_recurrence_jours: 30,
      tarif_propose_rappel_jours: 2,
      tarif_propose_escalade_jours: 5,
    });
  });

  it('ordre des fichiers SQL : une fonction redéfinie l’est par des fichiers numérotés dans l’ordre, la DERNIÈRE définition étant la plus récente', () => {
    const fichiers = fs.readdirSync(DOSSIER_SQL).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
    const definitions = new Map<string, string[]>();
    for (const f of fichiers) {
      const sql = fs.readFileSync(path.join(DOSSIER_SQL, f), 'utf8');
      for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/gi)) {
        definitions.set(m[1], [...(definitions.get(m[1]) ?? []), f]);
      }
    }
    // la fonction qui fige la trace : 082 puis 083 (à appliquer dans cet ordre — voir docs/DEPLOIEMENT.md)
    expect(definitions.get('lignes_facturation_tarif_fige')).toEqual([
      '082_resolution_tarif_trace.sql',
      '083_tarifs_proposes.sql',
    ]);
    for (const [fonction, fichiersDef] of definitions) {
      const tries = [...fichiersDef].sort();
      expect({ fonction, fichiersDef }).toEqual({ fonction, fichiersDef: tries });
    }
  });
});
