import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemandeVitrineDto, InscriptionNewsletterDto } from './dto/vitrine.dto';
import { StatistiquesService } from './statistiques.service';
import { VitrineService } from './vitrine.service';

const CONTACT: DemandeVitrineDto = {
  type: 'CONTACT',
  structure: 'Coopérative des transporteurs d’Abobo',
  effectif: 240,
  email: 'rh@coop-abobo.ci',
  telephone: '+225 07 48 22 19 63',
  objet: 'Couverture santé de nos membres',
  message: 'Bonjour, nous souhaitons un devis.',
};

describe('VitrineService — formulaires publics de la page d’accueil', () => {
  let service: VitrineService;
  let prisma: { newsletterAbonne: { upsert: jest.Mock }; organisation: { findFirst: jest.Mock } };
  let email: { envoyerEmail: jest.Mock };
  let moduleStats: { obtenir: jest.Mock };

  beforeEach(async () => {
    process.env.CONTACT_EMAIL = 'contact@plateforme.ci';
    prisma = {
      newsletterAbonne: { upsert: jest.fn().mockResolvedValue({}) },
      organisation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    email = { envoyerEmail: jest.fn().mockResolvedValue({ envoye: true, id: 'em_1' }) };
    moduleStats = { obtenir: jest.fn().mockResolvedValue({ arreteAu: '2026-09-29', seuilMinimum: 100, compteurs: {} }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VitrineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: StatistiquesService, useValue: moduleStats },
      ],
    }).compile();
    service = moduleRef.get(VitrineService);
  });

  // --- Demandes -------------------------------------------------------------

  it('Contact : envoie un e-mail à CONTACT_EMAIL, réponse = e-mail du demandeur, corps complet', async () => {
    const res = await service.envoyerDemande(CONTACT, '41.202.1.1');

    expect(res.ok).toBe(true);
    const [dest, sujet, corps, options] = email.envoyerEmail.mock.calls[0];
    expect(dest).toBe('contact@plateforme.ci');
    expect(sujet).toBe('[Site] Demande de contact - Coopérative des transporteurs d’Abobo');
    expect(options).toEqual({ replyTo: 'rh@coop-abobo.ci' });
    for (const attendu of ['240', 'rh@coop-abobo.ci', '+225 07 48 22 19 63', 'Couverture santé de nos membres', 'nous souhaitons un devis']) {
      expect(corps).toContain(attendu);
    }
  });

  it('Devenir partenaire : la catégorie (pharmacie) apparaît dans le sujet et le corps', async () => {
    await service.envoyerDemande(
      { ...CONTACT, type: 'PARTENAIRE', effectif: undefined, categorie: 'PHARMACIE', structure: 'Pharmacie des Deux Plateaux', ville: 'Cocody' },
      '41.202.1.2',
    );
    const [, sujet, corps] = email.envoyerEmail.mock.calls[0];
    expect(sujet).toBe('[Site] Candidature partenaire - Pharmacie des Deux Plateaux');
    expect(corps).toContain('Catégorie : Pharmacie');
    expect(corps).toContain('Ville : Cocody');
    expect(corps).not.toContain('Latitude');
  });

  it('Devenir partenaire : latitude, longitude (6 décimales) et lien carte dans le corps', async () => {
    await service.envoyerDemande(
      { ...CONTACT, type: 'PARTENAIRE', effectif: undefined, categorie: 'ETABLISSEMENT', ville: 'Abidjan', latitude: 5.3599517, longitude: -4.0082563 },
      '41.202.1.7',
    );
    const [, , corps] = email.envoyerEmail.mock.calls[0];
    expect(corps).toContain('Ville : Abidjan');
    expect(corps).toContain('Latitude : 5.359952');
    expect(corps).toContain('Longitude : -4.008256');
    expect(corps).toContain('https://www.openstreetmap.org/?mlat=5.359952&mlon=-4.008256#map=18/5.359952/-4.008256');
  });

  it('pot de miel rempli : MÊME réponse qu’un succès, aucun e-mail envoyé', async () => {
    const vrai = await service.envoyerDemande(CONTACT, '41.202.1.3');
    email.envoyerEmail.mockClear();
    const robot = await service.envoyerDemande({ ...CONTACT, siteWeb: 'http://spam.example' }, '41.202.1.4');
    expect(robot).toEqual(vrai);
    expect(email.envoyerEmail).not.toHaveBeenCalled();
  });

  it('limiteur : 3 demandes par IP, la 4e → 429 sans e-mail', async () => {
    for (let i = 0; i < 3; i++) await service.envoyerDemande(CONTACT, '41.202.9.9');
    email.envoyerEmail.mockClear();
    const err = await service.envoyerDemande(CONTACT, '41.202.9.9').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().message).toMatch(/Trop de tentatives/);
    expect(email.envoyerEmail).not.toHaveBeenCalled();
  });

  it('un robot sur le pot de miel est aussi limité (il consomme son quota)', async () => {
    for (let i = 0; i < 3; i++) await service.envoyerDemande({ ...CONTACT, siteWeb: 'x' }, '6.6.6.6');
    await expect(service.envoyerDemande({ ...CONTACT, siteWeb: 'x' }, '6.6.6.6')).rejects.toBeInstanceOf(HttpException);
  });

  it('CONTACT_EMAIL absent → 503 explicite, jamais un faux succès', async () => {
    delete process.env.CONTACT_EMAIL;
    await expect(service.envoyerDemande(CONTACT, '41.202.1.5')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('échec Resend → 503 (le visiteur sait que sa demande n’est pas partie)', async () => {
    email.envoyerEmail.mockResolvedValue({ envoye: false, erreur: 'boom' });
    await expect(service.envoyerDemande(CONTACT, '41.202.1.6')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // --- Page d'une société (/{slug}) ----------------------------------------

  const SOCIETE = {
    id: 'bbbbbbbb-0000-0000-0000-000000000002',
    slug: 'mutuelle-abidjan',
    nom: 'Mutuelle d’Abidjan',
    logoUrl: 'https://x/logo.png',
    emailContact: 'contact@mutuelle-abidjan.ci',
  };

  it('demande depuis /{slug} : e-mail à la société, sujet et corps avec son nom, son slug et son organisation_id', async () => {
    prisma.organisation.findFirst.mockResolvedValue(SOCIETE);
    await service.envoyerDemande({ ...CONTACT, organisation: 'mutuelle-abidjan' }, '41.202.4.1');
    expect(prisma.organisation.findFirst).toHaveBeenCalledWith({
      where: { slug: 'mutuelle-abidjan', deletedAt: null, statut: 'ACTIVE' },
      select: expect.objectContaining({ id: true, slug: true, nom: true, emailContact: true }),
    });
    const [dest, sujet, corps, options] = email.envoyerEmail.mock.calls[0];
    expect(dest).toBe('contact@mutuelle-abidjan.ci');
    expect(sujet).toBe('[Site Mutuelle d’Abidjan] Demande de contact - Coopérative des transporteurs d’Abobo');
    expect(corps).toContain('reçue depuis la page d’accueil de Mutuelle d’Abidjan (/mutuelle-abidjan)');
    expect(corps).toContain('organisation_id bbbbbbbb-0000-0000-0000-000000000002');
    expect(options).toEqual({ replyTo: 'rh@coop-abobo.ci' });
  });

  it('société sans e-mail de contact → CONTACT_EMAIL de la plateforme (corps toujours identifié)', async () => {
    prisma.organisation.findFirst.mockResolvedValue({ ...SOCIETE, emailContact: null });
    await service.envoyerDemande({ ...CONTACT, organisation: 'mutuelle-abidjan' }, '41.202.4.2');
    const [dest, , corps] = email.envoyerEmail.mock.calls[0];
    expect(dest).toBe('contact@plateforme.ci');
    expect(corps).toContain('organisation_id bbbbbbbb-0000-0000-0000-000000000002');
  });

  it('slug inconnu ou société inactive → 400, aucun e-mail', async () => {
    await expect(service.envoyerDemande({ ...CONTACT, organisation: 'inconnue' }, '41.202.4.3')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(email.envoyerEmail).not.toHaveBeenCalled();
  });

  it('demande depuis la page principale : inchangée (CONTACT_EMAIL, sujet [Site])', async () => {
    await service.envoyerDemande(CONTACT, '41.202.4.4');
    expect(prisma.organisation.findFirst).not.toHaveBeenCalled();
    expect(email.envoyerEmail.mock.calls[0][1]).toMatch(/^\[Site\] /);
  });

  it('fiche publique : identité, bannière et contact seulement (jamais l’identifiant) ; 404 si inconnue', async () => {
    prisma.organisation.findFirst.mockResolvedValueOnce({
      ...SOCIETE,
      telephoneContact: '+225 27 20 00 00 00',
      heroTitre: 'Votre santé, notre engagement',
      heroSousTitre: null,
      heroImageUrl: null,
    });
    expect(await service.obtenirOrganisation('mutuelle-abidjan', '41.202.4.5')).toEqual({
      slug: 'mutuelle-abidjan',
      nom: 'Mutuelle d’Abidjan',
      logoUrl: 'https://x/logo.png',
      emailContact: 'contact@mutuelle-abidjan.ci',
      telephoneContact: '+225 27 20 00 00 00',
      heroTitre: 'Votre santé, notre engagement',
      heroSousTitre: null,
      heroImageUrl: null,
    });
    await expect(service.obtenirOrganisation('absente', '41.202.4.5')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('statistiques d’une société : calculées sur SON organisation ; slug inconnu → 404', async () => {
    const stats = moduleStats;
    prisma.organisation.findFirst.mockResolvedValueOnce(SOCIETE);
    await service.obtenirStatistiques('41.202.4.6', 'mutuelle-abidjan');
    expect(stats.obtenir).toHaveBeenCalledWith(SOCIETE.id);
    await expect(service.obtenirStatistiques('41.202.4.6', 'absente')).rejects.toBeInstanceOf(NotFoundException);
    await service.obtenirStatistiques('41.202.4.6');
    expect(stats.obtenir).toHaveBeenLastCalledWith();
  });

  // --- Statistiques ---------------------------------------------------------

  it('statistiques : 60 lectures par IP, la 61e → 429', async () => {
    for (let i = 0; i < 60; i++) await service.obtenirStatistiques('41.202.3.1');
    const err = await service.obtenirStatistiques('41.202.3.1').catch((e) => e);
    expect(err.getStatus()).toBe(429);
  });

  // --- Newsletter -----------------------------------------------------------

  it('newsletter : e-mail en minuscules, upsert idempotent (réactive une désinscription)', async () => {
    const res = await service.inscrireNewsletter({ email: 'Awa.Diallo@Exemple.CI' }, '41.202.2.1');
    expect(res.ok).toBe(true);
    expect(prisma.newsletterAbonne.upsert).toHaveBeenCalledWith({
      where: { email: 'awa.diallo@exemple.ci' },
      create: { email: 'awa.diallo@exemple.ci' },
      update: { deletedAt: null },
    });
  });

  it('newsletter : pot de miel → même réponse, rien écrit', async () => {
    const res = await service.inscrireNewsletter({ email: 'bot@spam.example', siteWeb: 'x' }, '41.202.2.2');
    expect(res).toEqual({ ok: true, message: 'Merci, votre inscription est enregistrée.' });
    expect(prisma.newsletterAbonne.upsert).not.toHaveBeenCalled();
  });

  it('newsletter : 5 par IP, la 6e → 429', async () => {
    for (let i = 0; i < 5; i++) await service.inscrireNewsletter({ email: `a${i}@x.ci` }, '41.202.2.3');
    const err = await service.inscrireNewsletter({ email: 'a9@x.ci' }, '41.202.2.3').catch((e) => e);
    expect(err.getStatus()).toBe(429);
  });
});

describe('DemandeVitrineDto — validation par type de formulaire', () => {
  const erreurs = async (o: object) =>
    (await validate(plainToInstance(DemandeVitrineDto, o))).map((e) => e.property);

  it('Contact valide', async () => {
    expect(await erreurs(CONTACT)).toEqual([]);
  });

  it('Contact : effectif obligatoire', async () => {
    expect(await erreurs({ ...CONTACT, effectif: undefined })).toContain('effectif');
  });

  it('Partenaire : catégorie obligatoire, effectif non requis', async () => {
    const e = await erreurs({ ...CONTACT, type: 'PARTENAIRE', effectif: undefined });
    expect(e).toContain('categorie');
    expect(e).not.toContain('effectif');
  });

  it('Partenaire : coordonnées facultatives, mais valides et fournies ensemble', async () => {
    const P = { ...CONTACT, type: 'PARTENAIRE', effectif: undefined, categorie: 'PHARMACIE' };
    expect(await erreurs(P)).toEqual([]);
    expect(await erreurs({ ...P, latitude: '5.36', longitude: '-4.0083' })).toEqual([]); // FormData → chaînes
    expect(await erreurs({ ...P, latitude: 91, longitude: 0 })).toEqual(['latitude']);
    expect(await erreurs({ ...P, latitude: 5.36, longitude: -181 })).toEqual(['longitude']);
    expect(await erreurs({ ...P, latitude: 5.36 })).toEqual(['longitude']);
    expect(await erreurs({ ...P, latitude: 'abc', longitude: -4 })).toEqual(['latitude']);
  });

  it('e-mail et téléphone invalides refusés, type inconnu refusé', async () => {
    const e = await erreurs({ ...CONTACT, email: 'pas-un-mail', telephone: 'abc', type: 'AUTRE' });
    expect(e).toEqual(expect.arrayContaining(['email', 'telephone', 'type']));
  });

  it('newsletter : e-mail requis et valide', async () => {
    const e = (await validate(plainToInstance(InscriptionNewsletterDto, { email: 'nope' }))).map((x) => x.property);
    expect(e).toEqual(['email']);
  });
});
