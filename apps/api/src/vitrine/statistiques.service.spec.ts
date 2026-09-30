import { PrismaService } from '../prisma/prisma.service';
import { StatistiquesService, arrondiPublic } from './statistiques.service';

describe('arrondiPublic — arrondi vers le bas et seuil', () => {
  it.each([
    [99, 100, null],
    [100, 100, 100],
    [187, 100, 180],
    [999, 100, 990],
    [1_234, 100, 1_200],
    [9_999, 100, 9_900],
    [48_761, 100, 48_000],
  ])('%i (seuil %i) → %p', (valeur, seuil, attendu) => {
    expect(arrondiPublic(valeur, seuil)).toBe(attendu);
  });
});

describe('StatistiquesService — compteurs publics agrégés', () => {
  let prisma: Record<string, { count: jest.Mock }>;
  let service: StatistiquesService;
  let maintenant: Date;

  const compter = (n: number) => jest.fn().mockResolvedValue(n);
  beforeEach(() => {
    delete process.env.STATS_SEUIL_MINIMUM;
    maintenant = new Date('2026-09-30T14:25:00Z');
    prisma = {
      codeConsultation: { count: compter(1_234) },
      ordonnance: { count: compter(187) },
      ticketSoins: { count: compter(42) },
      factureMensuelleEtablissement: { count: compter(60) },
      factureMensuellePharmacie: { count: compter(55) },
    };
    service = new StatistiquesService(prisma as unknown as PrismaService);
    jest.spyOn(service, 'maintenant').mockImplementation(() => maintenant);
  });

  it('arrondit, masque sous le seuil (null, pas même arrondi) et additionne les deux types de factures payées', async () => {
    const res = await service.obtenir();
    expect(res).toEqual({
      arreteAu: '2026-09-29',
      seuilMinimum: 100,
      compteurs: {
        codesConsultation: 1_200,
        ordonnancesTraitees: 180,
        ticketsSoins: null, // 42 < 100 : jamais transmis
        facturesReglees: 110, // 60 + 55 = 115 → 110
      },
    });
  });

  it('réponse strictement limitée à ces champs : aucun identifiant, aucune ventilation par organisation', async () => {
    const res = await service.obtenir();
    expect(Object.keys(res).sort()).toEqual(['arreteAu', 'compteurs', 'seuilMinimum']);
    expect(Object.keys(res.compteurs).sort()).toEqual(['codesConsultation', 'facturesReglees', 'ordonnancesTraitees', 'ticketsSoins']);
    expect(JSON.stringify(res)).not.toMatch(/organisation|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it('instantané quotidien : ne compte que les enregistrements créés AVANT aujourd’hui 00:00 UTC', async () => {
    await service.obtenir();
    const debutJour = new Date('2026-09-30T00:00:00.000Z');
    for (const m of Object.values(prisma)) {
      expect(m.count).toHaveBeenCalledWith({ where: expect.objectContaining({ createdAt: { lt: debutJour } }) });
    }
    expect(prisma.ordonnance.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ deletedAt: null, statut: { in: ['PARTIELLEMENT_DELIVREE', 'COMPLETEMENT_DELIVREE'] } }),
    });
    expect(prisma.ticketSoins.count).toHaveBeenCalledWith({ where: expect.objectContaining({ statut: { not: 'ANNULE' } }) });
    // Statut « payée » réel en base (CHECK factures_mensuelles_*_statut_check) : PAYEE, pas PAYE.
    expect(prisma.factureMensuelleEtablissement.count).toHaveBeenCalledWith({ where: expect.objectContaining({ statut: 'PAYEE' }) });
    expect(prisma.factureMensuellePharmacie.count).toHaveBeenCalledWith({ where: expect.objectContaining({ statut: 'PAYEE' }) });
  });

  it('cache : un seul calcul par jour, recalcul le lendemain', async () => {
    await service.obtenir();
    maintenant = new Date('2026-09-30T23:59:00Z');
    await service.obtenir();
    expect(prisma.codeConsultation.count).toHaveBeenCalledTimes(1);
    maintenant = new Date('2026-10-01T00:01:00Z');
    const res = await service.obtenir();
    expect(prisma.codeConsultation.count).toHaveBeenCalledTimes(2);
    expect(res.arreteAu).toBe('2026-09-30');
  });

  it('seuil configurable (STATS_SEUIL_MINIMUM) mais jamais sous 10', async () => {
    process.env.STATS_SEUIL_MINIMUM = '40';
    expect((await service.obtenir()).compteurs.ticketsSoins).toBe(40);
    process.env.STATS_SEUIL_MINIMUM = '1';
    expect(service.seuil).toBe(10);
    process.env.STATS_SEUIL_MINIMUM = 'n’importe quoi';
    expect(service.seuil).toBe(100);
  });

  it('base vide (état actuel) : tous les compteurs masqués', async () => {
    for (const m of Object.values(prisma)) m.count.mockResolvedValue(0);
    const res = await service.obtenir();
    expect(Object.values(res.compteurs)).toEqual([null, null, null, null]);
  });
});
