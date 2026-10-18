import { creneauxDuJour, creneauxLibres, jourSemaineDe, lienGoogleAgenda, type RegleAgenda } from './agenda';

const r = (p: Partial<RegleAgenda>): RegleAgenda => ({ type: 'JOUR', dateJour: null, jourSemaine: null, valideDu: null, valideAu: null, heureDebut: '08:00', heureFin: '12:00', dureeCreneauMin: 30, ...p });
const heures = (cs: { debut: Date }[]) => cs.map((c) => c.debut.toISOString().slice(11, 16));

describe('agenda de présence — créneaux', () => {
  it('jour de la semaine ISO', () => {
    expect(jourSemaineDe('2026-10-19')).toBe(1); // lundi
    expect(jourSemaineDe('2026-10-25')).toBe(7); // dimanche
  });

  it('règle hebdomadaire : créneaux de 30 min de 8h à 12h', () => {
    const c = creneauxDuJour('2026-10-19', [r({ jourSemaine: 1 })]);
    expect(c).toHaveLength(8);
    expect(heures(c)[0]).toBe('08:00');
    expect(heures(c)[7]).toBe('11:30');
    expect(c[7].fin.toISOString().slice(11, 16)).toBe('12:00');
  });

  it('un autre jour de la semaine ne produit rien', () => {
    expect(creneauxDuJour('2026-10-20', [r({ jourSemaine: 1 })])).toEqual([]);
  });

  it('plusieurs plages le même jour (matin et après-midi) avec des durées différentes', () => {
    const c = creneauxDuJour('2026-10-19', [r({ jourSemaine: 1 }), r({ jourSemaine: 1, heureDebut: '14:00', heureFin: '16:00', dureeCreneauMin: 60 })]);
    expect(heures(c).slice(-2)).toEqual(['14:00', '15:00']);
    expect(c).toHaveLength(10);
  });

  it('la durée qui ne tient pas dans la plage ne produit pas de créneau partiel', () => {
    expect(creneauxDuJour('2026-10-19', [r({ jourSemaine: 1, heureDebut: '08:00', heureFin: '08:50', dureeCreneauMin: 30 })])).toHaveLength(1);
  });

  it('une règle « date précise » remplace la règle hebdomadaire ce jour-là', () => {
    const c = creneauxDuJour('2026-10-19', [r({ jourSemaine: 1 }), r({ type: 'DATE', dateJour: '2026-10-19', heureDebut: '10:00', heureFin: '11:00', dureeCreneauMin: 20 })]);
    expect(heures(c)).toEqual(['10:00', '10:20', '10:40']);
  });

  it('une absence retire les créneaux qui la chevauchent', () => {
    const c = creneauxDuJour('2026-10-19', [r({ jourSemaine: 1 }), r({ type: 'ABSENCE', dateJour: '2026-10-19', heureDebut: '09:00', heureFin: '10:00', dureeCreneauMin: null })]);
    expect(heures(c)).not.toContain('09:00');
    expect(heures(c)).not.toContain('09:30');
    expect(heures(c)).toContain('08:30');
    expect(heures(c)).toContain('10:00');
  });

  it('absence sur la journée entière', () => {
    expect(creneauxDuJour('2026-10-19', [r({ jourSemaine: 1 }), r({ type: 'ABSENCE', dateJour: '2026-10-19', heureDebut: '00:00', heureFin: '23:59', dureeCreneauMin: null })])).toEqual([]);
  });

  it('la période de validité d’une règle hebdomadaire est respectée', () => {
    const regle = r({ jourSemaine: 1, valideDu: '2026-10-26', valideAu: '2026-11-02' });
    expect(creneauxDuJour('2026-10-19', [regle])).toEqual([]);
    expect(creneauxDuJour('2026-10-26', [regle]).length).toBeGreaterThan(0);
    expect(creneauxDuJour('2026-11-09', [regle])).toEqual([]);
  });

  it('créneaux libres : retire les créneaux pris et le passé', () => {
    const regles = [r({ jourSemaine: 1 })];
    const pris = [{ debut: new Date('2026-10-19T09:00:00Z'), fin: new Date('2026-10-19T09:30:00Z') }];
    const libres = creneauxLibres('2026-10-19', '2026-10-19', regles, pris, new Date('2026-10-19T08:10:00Z'));
    expect(heures(libres[0].creneaux)).toEqual(['08:30', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('créneaux libres : jours sans créneau absents, plage de plusieurs jours', () => {
    const libres = creneauxLibres('2026-10-19', '2026-10-26', [r({ jourSemaine: 1 })], [], new Date('2026-10-01T00:00:00Z'));
    expect(libres.map((j) => j.date)).toEqual(['2026-10-19', '2026-10-26']);
  });
});

describe('lien Google Agenda', () => {
  it('construit le modèle d’événement avec dates UTC, titre et lieu', () => {
    const lien = lienGoogleAgenda({ titre: 'Rendez-vous médical — Clinique A', debut: new Date('2026-10-20T09:00:00Z'), fin: new Date('2026-10-20T09:30:00Z'), details: 'Médecin : Dr X', lieu: 'Cocody, Abidjan' });
    const u = new URL(lien);
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('text')).toBe('Rendez-vous médical — Clinique A');
    expect(u.searchParams.get('dates')).toBe('20261020T090000Z/20261020T093000Z');
    expect(u.searchParams.get('location')).toBe('Cocody, Abidjan');
  });
});
