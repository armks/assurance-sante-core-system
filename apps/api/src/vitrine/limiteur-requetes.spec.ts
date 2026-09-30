import { LimiteurRequetes } from './limiteur-requetes';

describe('LimiteurRequetes — fenêtre glissante par clé + plafond global', () => {
  let t: number;
  const horloge = () => t;
  beforeEach(() => {
    t = 1_000_000;
  });

  it('autorise jusqu’à la limite par clé, puis refuse avec un délai de nouvel essai', () => {
    const l = new LimiteurRequetes({ parCle: 3, global: 100, fenetreMs: 60_000 }, horloge);
    expect(l.consommer('1.1.1.1')).toEqual({ autorise: true });
    t += 1000;
    expect(l.consommer('1.1.1.1')).toEqual({ autorise: true });
    expect(l.consommer('1.1.1.1')).toEqual({ autorise: true });
    expect(l.consommer('1.1.1.1')).toEqual({ autorise: false, reessayerDansS: 59 });
  });

  it('une autre IP n’est pas affectée par la limite d’une première', () => {
    const l = new LimiteurRequetes({ parCle: 1, global: 100, fenetreMs: 60_000 }, horloge);
    l.consommer('1.1.1.1');
    expect(l.consommer('1.1.1.1').autorise).toBe(false);
    expect(l.consommer('2.2.2.2').autorise).toBe(true);
  });

  it('fenêtre GLISSANTE : une requête redevient possible dès que la plus ancienne sort de la fenêtre', () => {
    const l = new LimiteurRequetes({ parCle: 2, global: 100, fenetreMs: 60_000 }, horloge);
    l.consommer('ip');
    t += 30_000;
    l.consommer('ip');
    expect(l.consommer('ip').autorise).toBe(false);
    t += 30_001; // la 1re sort de la fenêtre, pas la 2e
    expect(l.consommer('ip').autorise).toBe(true);
    expect(l.consommer('ip').autorise).toBe(false);
  });

  it('plafond GLOBAL : bloque même en changeant d’IP à chaque requête (X-Forwarded-For falsifié)', () => {
    const l = new LimiteurRequetes({ parCle: 100, global: 3, fenetreMs: 60_000 }, horloge);
    expect(l.consommer('a').autorise).toBe(true);
    expect(l.consommer('b').autorise).toBe(true);
    expect(l.consommer('c').autorise).toBe(true);
    expect(l.consommer('d').autorise).toBe(false);
  });

  it('une requête refusée ne consomme pas de quota (pas de verrouillage prolongé)', () => {
    const l = new LimiteurRequetes({ parCle: 1, global: 100, fenetreMs: 60_000 }, horloge);
    l.consommer('ip');
    for (let i = 0; i < 10; i++) l.consommer('ip'); // refusées
    t += 60_001;
    expect(l.consommer('ip').autorise).toBe(true);
  });
});
