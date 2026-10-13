import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PropositionsMembresService } from './propositions-membres.service';

const USER = { sub: 'u1' } as never;

function creer(role: string, societeId: string | null = 'soc-1') {
  const audits: string[] = [];
  const base = {
    propositionMembre: {
      create: jest.fn(async ({ data }: any) => ({ id: 'p1', statut: 'EN_ATTENTE', createdAt: new Date(), dateDecision: null, motifRejet: null, adherentCreeId: null, beneficiaireCreeId: null, ...data })),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
    },
    souscripteur: { findFirst: jest.fn(async () => ({ id: 'soc-1', nom: 'Société', statut: 'ACTIF' })), findMany: jest.fn(async () => []) },
    police: { findFirst: jest.fn(async () => ({ id: 'pol-1' })), findMany: jest.fn(async () => []) },
    adherent: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 'a-new', numeroAdherent: 'ADH-1', ...data })) },
    beneficiaire: { create: jest.fn(async () => ({ id: 'b-new' })) },
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, ...v: unknown[]) => { audits.push(String(v[0])); return 1; }),
  };
  const prisma: any = { ...base, $transaction: jest.fn(async (fn: any) => fn(prisma)) };
  const identity = { getMe: jest.fn(async () => ({ profil: { id: 'u1', organisationId: 'org-1', societeId }, permissions: { roleChain: [role] } })) };
  const cartes = { genererCarteAdherent: jest.fn(async () => ({})), genererCarteBeneficiaire: jest.fn(async () => ({})) };
  const service = new PropositionsMembresService(prisma, identity as never, cartes as never);
  return { service, prisma, cartes, audits };
}

const ADH = { nom: 'Fict', prenom: 'Pat', dateNaissance: '1990-01-01', sexe: 'F', policeId: '11111111-1111-4111-8111-111111111111', email: 'pat@assurance-sante.test', telephone: '+22501020304' };

describe('PropositionsMembresService — proposer', () => {
  it('la société propose : une proposition EN_ATTENTE, aucun adhérent créé', async () => {
    const { service, prisma, audits } = creer('SOCIETE_ADMINISTRATION');
    const r = await service.proposerAdherent(USER, ADH);
    expect(r.statut).toBe('EN_ATTENTE');
    expect(prisma.adherent.create).not.toHaveBeenCalled();
    expect(audits).toContain('PROPOSITION_ADHERENT');
  });

  it('au moins un contact : ni téléphone ni e-mail → 400', async () => {
    const { service } = creer('SOCIETE_ADMINISTRATION');
    await expect(service.proposerAdherent(USER, { ...ADH, email: undefined, telephone: undefined })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un seul contact suffit (e-mail seul, téléphone seul)', async () => {
    const a = creer('SOCIETE_ADMINISTRATION');
    await expect(a.service.proposerAdherent(USER, { ...ADH, telephone: undefined })).resolves.toBeDefined();
    const b = creer('SOCIETE_ADMINISTRATION');
    await expect(b.service.proposerAdherent(USER, { ...ADH, email: undefined })).resolves.toBeDefined();
  });

  it('e-mail ou téléphone invalide → 400', async () => {
    const { service } = creer('SOCIETE_ADMINISTRATION');
    await expect(service.proposerAdherent(USER, { ...ADH, email: 'pas-un-mail' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.proposerAdherent(USER, { ...ADH, telephone: '12' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('formule : seulement une police ACTIVE de SA société (sinon 400)', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION');
    prisma.police.findFirst.mockResolvedValueOnce(null);
    await expect(service.proposerAdherent(USER, ADH)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.police.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ souscripteurId: 'soc-1', organisationId: 'org-1', statut: 'ACTIVE' }) });
  });

  it('e-mail déjà utilisé par un adhérent → 409', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION');
    prisma.adherent.findFirst.mockResolvedValueOnce({ id: 'x' });
    await expect(service.proposerAdherent(USER, ADH)).rejects.toBeInstanceOf(ConflictException);
  });

  it('entrant : mois d’effet ramené au 1er du mois ; un mois écoulé est refusé (400)', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION');
    const futur = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 17)).toISOString().slice(0, 10);
    await service.proposerAdherent(USER, { ...ADH, moisEffet: futur });
    expect(prisma.propositionMembre.create).toHaveBeenCalledWith({ data: expect.objectContaining({ moisEffet: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 1)) }) });
    await expect(service.proposerAdherent(USER, { ...ADH, moisEffet: '2020-01-10' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bénéficiaire : contacts facultatifs mais contrôlés, recopiés sur la proposition', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION');
    prisma.adherent.findFirst.mockResolvedValueOnce({ id: 'adh-1', statut: 'ACTIF' });
    const dto = { adherentId: '11111111-1111-4111-8111-111111111111', lienParente: 'ENFANT', nom: 'A', prenom: 'B', dateNaissance: '2015-01-01', sexe: 'M' };
    await service.proposerBeneficiaire(USER, { ...dto, telephone: '07 00 00 00 07', email: 'Papa@Exemple.ci' });
    expect(prisma.propositionMembre.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'BENEFICIAIRE', telephone: '0700000007', email: 'papa@exemple.ci' }) });
    prisma.adherent.findFirst.mockResolvedValueOnce({ id: 'adh-1', statut: 'ACTIF' });
    await expect(service.proposerBeneficiaire(USER, { ...dto, email: 'pas-un-mail' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['ASSUREUR_INFORMATIQUE', 'SOCIETE_RECEPTION', 'SOCIETE_COMPTABLE', 'ADHERENT_TITULAIRE'])('%s ne peut pas proposer (403)', async (role) => {
    const { service } = creer(role);
    await expect(service.proposerAdherent(USER, ADH)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bénéficiaire : le titulaire doit être de SA société (sinon 404)', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION');
    prisma.adherent.findFirst.mockResolvedValueOnce(null);
    await expect(service.proposerBeneficiaire(USER, { adherentId: '11111111-1111-4111-8111-111111111111', lienParente: 'ENFANT', nom: 'A', prenom: 'B', dateNaissance: '2015-01-01', sexe: 'M' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.adherent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ souscripteurId: 'soc-1', organisationId: 'org-1' }) }));
  });
});

describe('PropositionsMembresService — décisions', () => {
  const EN_ATTENTE = { id: 'p1', organisationId: 'org-1', souscripteurId: 'soc-1', type: 'ADHERENT', statut: 'EN_ATTENTE', nom: 'Fict', prenom: 'Pat', dateNaissance: new Date('1990-01-01'), sexe: 'F', policeId: 'pol-1', telephone: '+22501020304', email: 'pat@assurance-sante.test', adherentParentId: null, lienParente: null, createdAt: new Date() };

  it.each(['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION'])('%s valide : adhérent créé déjà validé, carte générée', async (role) => {
    const { service, prisma, cartes, audits } = creer(role, null);
    prisma.propositionMembre.findFirst.mockResolvedValue(EN_ATTENTE);
    prisma.propositionMembre.findUniqueOrThrow.mockResolvedValue({ ...EN_ATTENTE, statut: 'VALIDEE', adherentCreeId: 'a-new' });
    const r = await service.valider(USER, 'p1');
    expect(prisma.adherent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ souscripteurId: 'soc-1', policeId: 'pol-1', sexe: 'F', email: 'pat@assurance-sante.test', valideParId: 'u1', dateValidation: expect.any(Date) }) });
    expect(cartes.genererCarteAdherent).toHaveBeenCalledWith(USER, 'a-new');
    expect(audits).toEqual(expect.arrayContaining(['CREATION_ADHERENT_PROPOSITION', 'VALIDATION_PROPOSITION_MEMBRE']));
    expect(r.carteGeneree).toBe(true);
  });

  it('valide un entrant : date de validation = veille du 1er du mois d’effet', async () => {
    const { service, prisma } = creer('ASSUREUR_EXPLOITATION', null);
    const mois = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 5, 1));
    prisma.propositionMembre.findFirst.mockResolvedValue({ ...EN_ATTENTE, moisEffet: mois });
    prisma.propositionMembre.findUniqueOrThrow.mockResolvedValue({ ...EN_ATTENTE, statut: 'VALIDEE', adherentCreeId: 'a-new', moisEffet: mois });
    await service.valider(USER, 'p1');
    expect(prisma.adherent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dateValidation: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 4, 31)) }) });
  });

  it('valide un bénéficiaire : ses contacts sont recopiés sur la fiche créée', async () => {
    const { service, prisma } = creer('ASSUREUR_EXPLOITATION', null);
    const benef = { ...EN_ATTENTE, type: 'BENEFICIAIRE', policeId: null, adherentParentId: 'adh-1', lienParente: 'ENFANT', telephone: '0700000007', email: 'papa@exemple.ci' };
    prisma.propositionMembre.findFirst.mockResolvedValue(benef);
    prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', statut: 'ACTIF' });
    prisma.propositionMembre.findUniqueOrThrow.mockResolvedValue({ ...benef, statut: 'VALIDEE', beneficiaireCreeId: 'b-new' });
    await service.valider(USER, 'p1');
    expect(prisma.beneficiaire.create).toHaveBeenCalledWith({ data: expect.objectContaining({ telephone: '0700000007', email: 'papa@exemple.ci' }) });
  });

  it('valide un bénéficiaire : créé ACTIF sur son titulaire', async () => {
    const { service, prisma, cartes } = creer('ASSUREUR_EXPLOITATION', null);
    const benef = { ...EN_ATTENTE, type: 'BENEFICIAIRE', policeId: null, email: null, telephone: null, adherentParentId: 'adh-1', lienParente: 'ENFANT' };
    prisma.propositionMembre.findFirst.mockResolvedValue(benef);
    prisma.adherent.findFirst.mockResolvedValue({ id: 'adh-1', statut: 'ACTIF' });
    prisma.propositionMembre.findUniqueOrThrow.mockResolvedValue({ ...benef, statut: 'VALIDEE', beneficiaireCreeId: 'b-new' });
    await service.valider(USER, 'p1');
    expect(prisma.beneficiaire.create).toHaveBeenCalledWith({ data: expect.objectContaining({ adherentId: 'adh-1', lienParente: 'ENFANT', sexe: 'F' }) });
    expect(cartes.genererCarteBeneficiaire).toHaveBeenCalledWith(USER, 'adh-1', 'b-new');
  });

  it('rejet : motif obligatoire (≥ 5 caractères), proposition REJETEE, rien créé', async () => {
    const { service, prisma, audits } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue(EN_ATTENTE);
    prisma.propositionMembre.findUniqueOrThrow.mockResolvedValue({ ...EN_ATTENTE, statut: 'REJETEE', motifRejet: 'Doublon', dateDecision: new Date() });
    await expect(service.rejeter(USER, 'p1', '  ')).rejects.toBeInstanceOf(BadRequestException);
    const r = await service.rejeter(USER, 'p1', 'Doublon avéré');
    expect(r.statut).toBe('REJETEE');
    expect(prisma.adherent.create).not.toHaveBeenCalled();
    expect(prisma.propositionMembre.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', statut: 'EN_ATTENTE' }, data: expect.objectContaining({ statut: 'REJETEE', motifRejet: 'Doublon avéré' }) });
    expect(audits).toContain('REJET_PROPOSITION_MEMBRE');
  });

  it.each(['SOCIETE_ADMINISTRATION', 'ASSUREUR_COMPTABLE', 'ASSUREUR_DIRECTION', 'ADHERENT_TITULAIRE'])('%s ne valide ni ne rejette (403)', async (role) => {
    const { service, prisma } = creer(role, 'soc-1');
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.rejeter(USER, 'p1', 'motif valable')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('déjà traitée : 409, rien de créé', async () => {
    const { service, prisma } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue({ ...EN_ATTENTE, statut: 'REJETEE' });
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('traitement concurrent : la prise de la proposition échoue → 409, rien créé', async () => {
    const { service, prisma } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue(EN_ATTENTE);
    prisma.propositionMembre.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('la police n’est plus active à la validation : 409, rien créé', async () => {
    const { service, prisma } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue(EN_ATTENTE);
    prisma.police.findFirst.mockResolvedValue(null);
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.adherent.create).not.toHaveBeenCalled();
  });

  it('société archivée : validation impossible', async () => {
    const { service, prisma } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue(EN_ATTENTE);
    prisma.souscripteur.findFirst.mockResolvedValue({ id: 'soc-1', nom: 'S', statut: 'ARCHIVE' });
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('proposition d’une autre organisation / société : introuvable (404)', async () => {
    const { service, prisma } = creer('ASSUREUR_INFORMATIQUE', null);
    prisma.propositionMembre.findFirst.mockResolvedValue(null);
    await expect(service.valider(USER, 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.propositionMembre.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ organisationId: 'org-1' }) });
  });
});

describe('PropositionsMembresService — lecture', () => {
  it('une société ne lit QUE ses propositions (filtre imposé, même si elle en demande une autre)', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION', 'soc-1');
    await service.lister(USER, { souscripteurId: 'soc-autre' });
    expect(prisma.propositionMembre.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1', souscripteurId: 'soc-1' }) }));
  });

  it('l’assureur lit toute son organisation, filtrable par société et statut', async () => {
    const { service, prisma } = creer('ASSUREUR_EXPLOITATION', null);
    await service.lister(USER, { statut: 'EN_ATTENTE', souscripteurId: 'soc-2' });
    expect(prisma.propositionMembre.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organisationId: 'org-1', souscripteurId: 'soc-2', statut: 'EN_ATTENTE' }) }));
  });

  it('un rôle étranger au sujet ne lit pas (403)', async () => {
    const { service } = creer('CENTRE_MEDICAL_ACCUEIL', null);
    await expect(service.lister(USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('actions possibles calculées côté serveur (la société peut retirer, pas valider)', async () => {
    const { service, prisma } = creer('SOCIETE_ADMINISTRATION', 'soc-1');
    prisma.propositionMembre.findMany.mockResolvedValue([{ id: 'p1', organisationId: 'org-1', souscripteurId: 'soc-1', type: 'ADHERENT', statut: 'EN_ATTENTE', nom: 'A', prenom: 'B', dateNaissance: new Date('1990-01-01'), sexe: 'F', policeId: null, createdAt: new Date() }]);
    const [p] = await service.lister(USER);
    expect(p.actions.retirer.possible).toBe(true);
    expect(p.actions.valider.possible).toBe(false);
  });
});
