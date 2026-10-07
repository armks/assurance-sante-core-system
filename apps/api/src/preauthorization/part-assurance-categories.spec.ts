import { Test } from '@nestjs/testing';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';
import {
  categoriesActeDeLaMigration,
  categoriesActeServiceDeTest,
} from '../reference/categories-acte.testing';
import { PreauthorizationService } from './preauthorization.service';

/**
 * Part assurance / part patient PAR CATÉGORIE D'ACTE — référentiel unique
 * (prisma/sql/067) et règle « non couvert » (ARCHITECTURE-DECISIONS.md).
 *
 * Produit d'exemple (repris de l'analyse du 2026-10-07) : chaque catégorie du
 * référentiel a ici un comportement chiffré, couvert ou non. Le test
 * « chaque catégorie a un comportement défini » échoue si une catégorie est
 * ajoutée à la migration sans être ajoutée à ce tableau.
 */
type Garantie = { tauxCouverture: string; plafondParActe: string | null };
const PRODUIT: Record<string, Garantie> = {
  CONSULTATION: { tauxCouverture: '80', plafondParActe: null },
  HOSPITALISATION: { tauxCouverture: '100', plafondParActe: null },
  MATERNITE: { tauxCouverture: '100', plafondParActe: '300000' },
  PHARMACIE: { tauxCouverture: '80', plafondParActe: null },
  ANALYSES: { tauxCouverture: '70', plafondParActe: '40000' },
  IMAGERIE: { tauxCouverture: '70', plafondParActe: null },
  DENTAIRE: { tauxCouverture: '60', plafondParActe: null },
  SOINS_INFIRMIERS: { tauxCouverture: '90', plafondParActe: null },
  TRANSPORT: { tauxCouverture: '50', plafondParActe: '25000' },
  // OPTIQUE, ACTE_TECHNIQUE, AUTRE : aucune garantie → NON COUVERTS
};

/** Comportement attendu de chaque catégorie : montant facturé → (assurance, patient). */
const COMPORTEMENTS: Record<
  string,
  { montant: number; assurance: string; patient: string; couverte: boolean; exemple: string }
> = {
  CONSULTATION: { montant: 10000, assurance: '8000.00', patient: '2000.00', couverte: true, exemple: '80 %' },
  HOSPITALISATION: { montant: 1200000, assurance: '1200000.00', patient: '0.00', couverte: true, exemple: '100 %' },
  MATERNITE: { montant: 400000, assurance: '300000.00', patient: '100000.00', couverte: true, exemple: 'accouchement : 100 % plafonné à 300 000' },
  PHARMACIE: { montant: 20000, assurance: '16000.00', patient: '4000.00', couverte: true, exemple: '80 %' },
  ANALYSES: { montant: 60000, assurance: '40000.00', patient: '20000.00', couverte: true, exemple: 'ex-BIOLOGIE : 70 % = 42 000 plafonné à 40 000' },
  IMAGERIE: { montant: 50000, assurance: '35000.00', patient: '15000.00', couverte: true, exemple: '70 %' },
  DENTAIRE: { montant: 30000, assurance: '18000.00', patient: '12000.00', couverte: true, exemple: '60 %' },
  SOINS_INFIRMIERS: { montant: 5000, assurance: '4500.00', patient: '500.00', couverte: true, exemple: '90 %' },
  TRANSPORT: { montant: 80000, assurance: '25000.00', patient: '55000.00', couverte: true, exemple: 'ambulance : 50 % = 40 000 plafonné à 25 000' },
  OPTIQUE: { montant: 45000, assurance: '0.00', patient: '45000.00', couverte: false, exemple: 'non couvert' },
  ACTE_TECHNIQUE: { montant: 15000, assurance: '0.00', patient: '15000.00', couverte: false, exemple: 'non couvert (était 80 % par défaut)' },
  AUTRE: { montant: 7000, assurance: '0.00', patient: '7000.00', couverte: false, exemple: 'non couvert' },
};

const TYPES_RECLAMATION = ['SOIN', 'PHARMACIE', 'HOSPITALISATION', 'OPTIQUE', 'DENTAIRE', 'ANALYSES', 'IMAGERIE', 'AUTRE'];
const ROLES_REVUE = ['ASSUREUR_MEDECIN_CONSEIL', 'ASSUREUR_EXPLOITATION'];

describe('Référentiel des catégories d’acte (migration 067)', () => {
  const categories = categoriesActeDeLaMigration();

  it('contient exactement les 12 catégories validées', () => {
    expect(categories.map((c) => c.code).sort()).toEqual(
      ['ACTE_TECHNIQUE', 'ANALYSES', 'AUTRE', 'CONSULTATION', 'DENTAIRE', 'HOSPITALISATION',
        'IMAGERIE', 'MATERNITE', 'OPTIQUE', 'PHARMACIE', 'SOINS_INFIRMIERS', 'TRANSPORT'],
    );
  });

  it('chaque catégorie a un comportement défini (montants), un type de réclamation et un rôle de revue valides', () => {
    for (const c of categories) {
      expect({ code: c.code, defini: c.code in COMPORTEMENTS }).toEqual({ code: c.code, defini: true });
      expect(TYPES_RECLAMATION).toContain(c.typeReclamation);
      expect(ROLES_REVUE).toContain(c.roleRevue);
      expect(c.libelle.trim()).not.toBe('');
    }
    // et aucun comportement orphelin (catégorie retirée du référentiel)
    expect(Object.keys(COMPORTEMENTS).sort()).toEqual(categories.map((c) => c.code).sort());
  });

  it('les anciens codes ne sont plus dans le référentiel', () => {
    const codes = categories.map((c) => c.code);
    for (const ancien of ['BIOLOGIE', 'ANALYSES_LABORATOIRE', 'TRANSPORT_SANITAIRE']) {
      expect(codes).not.toContain(ancien);
    }
  });
});

describe('Part assurance par catégorie — facture et simulation (règle « non couvert »)', () => {
  let service: PreauthorizationService;
  let prisma: { garantie: { findMany: jest.Mock; findFirst: jest.Mock } };

  beforeEach(async () => {
    const garanties = Object.entries(PRODUIT).map(([categorieActe, g]) => ({
      id: `g-${categorieActe}`,
      produitId: 'prod-1',
      categorieActe,
      ...g,
    }));
    prisma = {
      garantie: {
        findMany: jest.fn().mockResolvedValue(garanties),
        findFirst: jest.fn(({ where }: { where: { categorieActe: string } }) =>
          Promise.resolve(garanties.find((g) => g.categorieActe === where.categorieActe) ?? null),
        ),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PreauthorizationService,
        { provide: PrismaService, useValue: prisma },
        { provide: IdentityService, useValue: {} },
        { provide: CareEpisodeService, useValue: {} },
        { provide: CategoriesActeService, useValue: categoriesActeServiceDeTest() },
      ],
    }).compile();
    service = moduleRef.get(PreauthorizationService);
  });

  for (const [categorie, attendu] of Object.entries(COMPORTEMENTS)) {
    it(`${categorie} — ${attendu.montant} F → assurance ${attendu.assurance} / patient ${attendu.patient} (${attendu.exemple})`, async () => {
      // facture (calculerMontantsPourActes)
      const facture = await (service as any).calculerMontantsPourActes('prod-1', [
        { montantPrescrit: String(attendu.montant), quantite: 1, categorieActe: categorie },
      ]);
      expect(facture.montantAssurance).toBe(attendu.assurance);
      expect(facture.montantPatient).toBe(attendu.patient);

      // simulation à l'ajout de l'acte — mêmes montants, couverture annoncée
      const simulation = await (service as any).simulerMontantActe('org-1', 'etab-1', 'prod-1', {
        categorieActe: categorie,
        montantPrescrit: attendu.montant,
        quantite: 1,
      });
      expect(simulation.categorieCouverte).toBe(attendu.couverte);
      expect(simulation.montants.montantSimuleAssurance).toBe(attendu.assurance);
      expect(simulation.montants.montantSimulePatient).toBe(attendu.patient);
    });
  }

  it('dossier mixte : seules les catégories couvertes réduisent la part patient', async () => {
    const r = await (service as any).calculerMontantsPourActes('prod-1', [
      { montantPrescrit: '10000', quantite: 1, categorieActe: 'CONSULTATION' },
      { montantPrescrit: '15000', quantite: 1, categorieActe: 'ACTE_TECHNIQUE' },
      { montantPrescrit: '60000', quantite: 1, categorieActe: 'ANALYSES' },
    ]);
    expect(r).toEqual({
      montantTotal: '85000.00',
      montantAssurance: '48000.00',
      montantPatient: '37000.00',
      partsAssurance: ['8000.00', '0.00', '40000.00'],
    });
  });
});
