import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemandeVitrineDto, InscriptionNewsletterDto } from './dto/vitrine.dto';
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
  let prisma: { newsletterAbonne: { upsert: jest.Mock } };
  let email: { envoyerEmail: jest.Mock };

  beforeEach(async () => {
    process.env.CONTACT_EMAIL = 'contact@plateforme.ci';
    prisma = { newsletterAbonne: { upsert: jest.fn().mockResolvedValue({}) } };
    email = { envoyerEmail: jest.fn().mockResolvedValue({ envoye: true, id: 'em_1' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VitrineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
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

  it('e-mail et téléphone invalides refusés, type inconnu refusé', async () => {
    const e = await erreurs({ ...CONTACT, email: 'pas-un-mail', telephone: 'abc', type: 'AUTRE' });
    expect(e).toEqual(expect.arrayContaining(['email', 'telephone', 'type']));
  });

  it('newsletter : e-mail requis et valide', async () => {
    const e = (await validate(plainToInstance(InscriptionNewsletterDto, { email: 'nope' }))).map((x) => x.property);
    expect(e).toEqual(['email']);
  });
});
