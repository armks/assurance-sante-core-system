import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AccueilCarteService, masquerEmail, masquerTelephone } from './accueil-carte.service';

const USER = { sub: 'u1' } as never;

function adherentBase(over: Record<string, unknown> = {}) {
  return {
    id: 'a1', nom: 'Doe', prenom: 'Jo', dateNaissance: new Date('1990-02-03'), photoUrl: 'p/a1.jpg', numeroCarte: 'CM-1',
    statut: 'ACTIF', email: 'jo.doe@mail.test', telephone: '+22501020304', policeId: 'p1',
    souscripteur: { nom: 'Société X', type: 'ENTREPRISE', statut: 'ACTIF', deletedAt: null },
    police: { id: 'p1', numeroPolice: 'POL-1', statut: 'ACTIVE', dateDebut: null, dateFin: null, deletedAt: null, produit: { nom: 'Produit Y' } },
    ...over,
  };
}

function creer(opts: { roleChain?: string[]; adherent?: unknown; beneficiaire?: unknown; smsActif?: boolean; blocages?: string[]; recents?: number } = {}) {
  const audits: string[] = [];
  const prisma = {
    adherent: { findFirst: jest.fn(async () => ('adherent' in opts ? opts.adherent : adherentBase())) },
    beneficiaire: { findFirst: jest.fn(async () => opts.beneficiaire ?? null) },
    etablissementSante: { findFirst: jest.fn(async () => ({ statut: 'ACTIF', nom: 'Clinique Z' })) },
    codeConsultation: { count: jest.fn(async () => opts.recents ?? 0), update: jest.fn(async () => ({})) },
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...vals: unknown[]) => { audits.push(String(vals[0])); return 1; }),
  };
  const identity = {
    getMe: jest.fn(async () => ({
      profil: { id: 'u1', organisationId: 'o1', etablissementId: 'e1' },
      permissions: { roleChain: opts.roleChain ?? ['CENTRE_MEDICAL_ACCUEIL'] },
    })),
  };
  const adherents = { urlPhotoSignee: jest.fn(async (c: string | null) => (c ? `https://signe/${c}` : null)) };
  const careEpisode = { evaluerEligibilite: jest.fn(async () => ({ blocages: opts.blocages ?? [] })) };
  const preauth = { emettreCodeAccueil: jest.fn(async () => ({ id: 'c1', code: 'ABC123', dateExpiration: new Date() })) };
  const categories = { actives: jest.fn(async () => [{ code: 'CONSULTATION', libelle: 'Consultation' }]) };
  const notifications = {
    canauxDisponibles: () => ({ EMAIL: { actif: true }, SMS: opts.smsActif ? { actif: true } : { actif: false, raison: 'SMS indisponible : fournisseur non configuré.' } }),
    smsActif: () => !!opts.smsActif,
    envoyer: jest.fn(async () => ({ statut: 'NON_ENVOYE_DESACTIVE', detail: 'x' })),
  };
  const service = new AccueilCarteService(prisma as never, identity as never, adherents as never, careEpisode as never, preauth as never, categories as never, notifications as never);
  return { service, prisma, preauth, notifications, audits };
}

describe('AccueilCarteService — fiche', () => {
  it('carte ACTIVE : expose uniquement les champs prévus et journalise la consultation', async () => {
    const { service, audits } = creer();
    const f = await service.fiche(USER, 'CM-1');
    expect(Object.keys(f).sort()).toEqual(['carte', 'contacts', 'dateNaissance', 'lien', 'nom', 'numeroCarte', 'photoUrl', 'police', 'prenom', 'produit', 'sexe', 'societe', 'souscripteur', 'type'].sort());
    expect(f.carte).toEqual({ mention: 'ACTIVE', active: true, motifs: [] });
    expect(f.photoUrl).toBe('https://signe/p/a1.jpg');
    expect(JSON.stringify(f)).not.toContain('jo.doe@mail.test');
    expect(JSON.stringify(f)).not.toContain('0102');
    expect(audits).toContain('CONSULTATION_FICHE_CARTE_ACCUEIL');
  });

  it.each([
    ['SUSPENDU', 'SUSPENDUE'],
    ['RADIE', 'RADIÉE'],
  ])('adhérent %s → %s', async (statut, mention) => {
    const { service } = creer({ adherent: adherentBase({ statut }) });
    expect((await service.fiche(USER, 'CM-1')).carte).toMatchObject({ mention, active: false });
  });

  it('bénéficiaire actif d’un titulaire radié → RADIÉE', async () => {
    const t = adherentBase({ statut: 'RADIE' });
    const { service } = creer({
      adherent: null,
      beneficiaire: { id: 'b1', nom: 'B', prenom: 'C', dateNaissance: new Date('2015-01-01'), photoUrl: null, numeroCarte: 'CM-2', statut: 'ACTIF', adherent: t },
    });
    const f = await service.fiche(USER, 'CM-2');
    expect(f.carte.mention).toBe('RADIÉE');
    expect(f.type).toBe('BENEFICIAIRE');
    expect(f.contacts.source).toBe('TITULAIRE');
  });

  it.each([
    [{ statut: 'SUSPENDUE' }],
    [{ dateFin: new Date('2000-01-01') }],
    [null],
  ])('police non active (%j) → POLICE NON ACTIVE', async (policeOver) => {
    const police = policeOver === null ? null : { ...adherentBase().police, ...policeOver };
    const { service } = creer({ adherent: adherentBase({ police }) });
    expect((await service.fiche(USER, 'CM-1')).carte.mention).toBe('POLICE NON ACTIVE');
  });

  it('société archivée → PÉRIMÈTRE NON ACTIF', async () => {
    const { service } = creer({ adherent: adherentBase({ souscripteur: { nom: 'S', type: 'ENTREPRISE', statut: 'ARCHIVE', deletedAt: null } }) });
    expect((await service.fiche(USER, 'CM-1')).carte.mention).toBe('PÉRIMÈTRE NON ACTIF');
  });

  it('carte d’une autre organisation : introuvable (recherche limitée à l’organisation) et tentative tracée', async () => {
    const { service, prisma, audits } = creer({ adherent: null });
    await expect(service.fiche(USER, 'CM-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.adherent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organisationId: 'o1' }) }));
    expect(audits).toContain('RECHERCHE_CARTE_INTROUVABLE');
  });

  it('refuse tout rôle autre que l’accueil', async () => {
    const { service } = creer({ roleChain: ['CENTRE_MEDICAL_MEDECIN'] });
    await expect(service.fiche(USER, 'CM-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('contacts masqués ; SMS grisé tant que le fournisseur n’est pas actif', async () => {
    const { service } = creer();
    const { liste } = (await service.fiche(USER, 'CM-1')).contacts;
    expect(liste).toEqual([
      expect.objectContaining({ canal: 'EMAIL', masque: masquerEmail('jo.doe@mail.test'), actif: true }),
      expect.objectContaining({ canal: 'SMS', masque: masquerTelephone('+22501020304'), actif: false }),
    ]);
  });
});

describe('AccueilCarteService — émission du code', () => {
  const dto = { numeroCarte: 'CM-1', categorieActe: 'CONSULTATION', canal: 'EMAIL' as const };

  it('envoie au contact ENREGISTRÉ de la fiche, jamais à une valeur du client, et ne renvoie pas le code', async () => {
    const { service, notifications } = creer();
    const r = await service.emettreCode(USER, { ...dto, destinataire: 'pirate@evil.test' } as never);
    expect(notifications.envoyer).toHaveBeenCalledWith('EMAIL', 'jo.doe@mail.test', 'ABC123', 'Clinique Z', 'Consultation');
    expect(JSON.stringify(r)).not.toContain('ABC123');
  });

  it.each([
    ['SUSPENDU', 'SUSPENDUE'],
    ['RADIE', 'RADIÉE'],
  ])('carte %s : refus 409, rien d’émis', async (statut) => {
    const { service, preauth, audits } = creer({ adherent: adherentBase({ statut }) });
    await expect(service.emettreCode(USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
    expect(audits).toContain('REFUS_EMISSION_CODE_ACCUEIL');
  });

  it('police non active : refus, rien d’émis', async () => {
    const { service, preauth } = creer({ adherent: adherentBase({ police: { ...adherentBase().police, statut: 'RESILIEE' } }) });
    await expect(service.emettreCode(USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
  });

  it('contact absent : refus clair, aucun code créé', async () => {
    const { service, preauth } = creer({ adherent: adherentBase({ email: null, telephone: null }) });
    await expect(service.emettreCode(USER, dto)).rejects.toThrow(/e-mail/);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
  });

  it('SMS sans fournisseur : refus, aucun code créé', async () => {
    const { service, preauth } = creer({ smsActif: false });
    await expect(service.emettreCode(USER, { ...dto, canal: 'SMS' })).rejects.toThrow(/fournisseur non configuré/);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
  });

  it('type d’acte inconnu ou désactivé : refus', async () => {
    const { service, preauth } = creer();
    await expect(service.emettreCode(USER, { ...dto, categorieActe: 'INVENTE' })).rejects.toThrow(/Type d’acte/);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
  });

  it('éligibilité (dossier déjà ouvert…) : blocages renvoyés, rien d’émis', async () => {
    const { service, preauth } = creer({ blocages: ['Un dossier est déjà ouvert.'] });
    await expect(service.emettreCode(USER, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(preauth.emettreCodeAccueil).not.toHaveBeenCalled();
  });

  it('limite horaire : 429 au-delà de 3 émissions', async () => {
    const { service } = creer({ recents: 3 });
    await expect(service.emettreCode(USER, dto)).rejects.toMatchObject({ status: 429 });
  });

  it('carte d’une autre organisation : introuvable', async () => {
    const { service } = creer({ adherent: null });
    await expect(service.emettreCode(USER, dto)).rejects.toBeInstanceOf(NotFoundException);
  });
});
