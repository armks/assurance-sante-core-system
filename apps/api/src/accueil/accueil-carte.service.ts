import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CareEpisodeService } from '../care-episode/care-episode.service';
import { IdentityService } from '../identity/identity.service';
import { AdherentService } from '../member/adherent.service';
import { ROLE_RECHERCHE_CARTE } from '../member/member.types';
import { NotificationCodeService, type CanalCode } from '../notifications/notification-code.service';
import { PreauthorizationService } from '../preauthorization/preauthorization.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesActeService } from '../reference/categories-acte.service';

export const MENTIONS_CARTE = [
  'ACTIVE',
  'SUSPENDUE',
  'RADIÉE',
  'SORTIE EN COURS',
  'POLICE NON ACTIVE',
  'PÉRIMÈTRE NON ACTIF',
] as const;
export type MentionCarte = (typeof MENTIONS_CARTE)[number];

/** Au plus N codes émis par l'accueil pour un même patient et un même établissement par heure (anti-harcèlement / anti-fraude). */
export const MAX_EMISSIONS_PAR_HEURE = 3;

interface Ctx {
  userId: string;
  organisationId: string;
  etablissementId: string;
}

/** `jo***@m***.com` — jamais l'adresse complète. */
export function masquerEmail(email: string): string {
  const [local, domaine = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domaine.slice(0, 1)}***${domaine.includes('.') ? domaine.slice(domaine.lastIndexOf('.')) : ''}`;
}

/** `•••• 42` — seuls les deux derniers chiffres restent visibles. */
export function masquerTelephone(tel: string): string {
  const chiffres = tel.replace(/\D/g, '');
  return `•••• ${chiffres.slice(-2)}`;
}

@Injectable()
export class AccueilCarteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly adherents: AdherentService,
    private readonly careEpisode: CareEpisodeService,
    private readonly preauth: PreauthorizationService,
    private readonly categories: CategoriesActeService,
    private readonly notifications: NotificationCodeService,
  ) {}

  private async contexte(user: AuthenticatedUser): Promise<Ctx> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException("Ce compte n'est rattaché à aucune organisation.");
    if (!(permissions?.roleChain ?? []).includes(ROLE_RECHERCHE_CARTE)) {
      throw new ForbiddenException("Cette fonction est réservée à l'accueil du centre médical.");
    }
    if (!profil.etablissementId) throw new ForbiddenException("Ce compte n'est rattaché à aucun établissement.");
    return { userId: profil.id, organisationId: profil.organisationId, etablissementId: profil.etablissementId };
  }

  private async audit(action: string, table: string, id: string, ctx: Ctx, details: Record<string, unknown>): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT log_audit(${action}::text, ${table}::text, ${id}::uuid, ${ctx.userId}::uuid, ${JSON.stringify(details)}::jsonb)`;
  }

  /** Types d'acte du menu : les catégories ACTIVES gérées par le superadmin. */
  async typesActe(user: AuthenticatedUser) {
    await this.contexte(user);
    return (await this.categories.actives()).map((c) => ({ code: c.code, libelle: c.libelle }));
  }

  private async charger(ctx: Ctx, numeroCarte: string) {
    const police = {
      select: { id: true, numeroPolice: true, statut: true, dateDebut: true, dateFin: true, deletedAt: true, produit: { select: { nom: true } } },
    };
    const souscripteur = { select: { nom: true, type: true, statut: true, deletedAt: true } };
    const adherent = await this.prisma.adherent.findFirst({
      where: { numeroCarte, organisationId: ctx.organisationId, deletedAt: null },
      select: {
        id: true, nom: true, prenom: true, dateNaissance: true, sexe: true, photoUrl: true, numeroCarte: true, statut: true,
        email: true, telephone: true, policeId: true, souscripteur, police,
      },
    });
    if (adherent) return { adherent, beneficiaire: null, titulaire: adherent };
    const beneficiaire = await this.prisma.beneficiaire.findFirst({
      where: { numeroCarte, deletedAt: null, adherent: { organisationId: ctx.organisationId, deletedAt: null } },
      select: {
        id: true, nom: true, prenom: true, dateNaissance: true, sexe: true, lienParente: true, photoUrl: true, numeroCarte: true, statut: true,
        adherent: { select: { id: true, statut: true, email: true, telephone: true, policeId: true, souscripteur, police } },
      },
    });
    if (beneficiaire) return { adherent: null, beneficiaire, titulaire: beneficiaire.adherent };
    return null;
  }

  private mention(
    membreStatut: string,
    titulaire: {
      statut: string;
      souscripteur: { statut: string; deletedAt: Date | null };
      police: { statut: string; dateDebut: Date | null; dateFin: Date | null; deletedAt: Date | null } | null;
    },
    etablissementActif: boolean,
  ): { mention: MentionCarte; motifs: string[] } {
    const motifs: string[] = [];
    const statuts = [membreStatut, titulaire.statut];
    if (statuts.includes('RADIE')) return { mention: 'RADIÉE', motifs: ['L’adhérent ou le bénéficiaire est radié.'] };
    if (statuts.includes('SUSPENDU')) return { mention: 'SUSPENDUE', motifs: ['L’adhérent ou le bénéficiaire est suspendu.'] };
    if (statuts.some((s) => s !== 'ACTIF')) return { mention: 'SORTIE EN COURS', motifs: ['Une sortie est en cours de validation.'] };
    const p = titulaire.police;
    const maintenant = new Date();
    if (!p || p.deletedAt) motifs.push('Aucune police rattachée.');
    else if (p.statut !== 'ACTIVE') motifs.push(`La police n’est pas active (statut : ${p.statut}).`);
    else if (p.dateDebut && maintenant < p.dateDebut) motifs.push('La police ne prend pas encore effet.');
    else if (p.dateFin && maintenant > p.dateFin) motifs.push('La police est expirée.');
    if (motifs.length) return { mention: 'POLICE NON ACTIVE', motifs };
    if (titulaire.souscripteur.statut !== 'ACTIF' || titulaire.souscripteur.deletedAt) motifs.push('La société de l’adhérent n’est plus active.');
    if (!etablissementActif) motifs.push('Votre établissement n’est pas actif dans le réseau.');
    if (motifs.length) return { mention: 'PÉRIMÈTRE NON ACTIF', motifs };
    return { mention: 'ACTIVE', motifs: [] };
  }

  /** Fiche d'accueil après « Rechercher » : uniquement les champs prévus, uniquement dans l'organisation de l'assureur ; consultation journalisée. */
  async fiche(user: AuthenticatedUser, numeroCarte: string) {
    if (!numeroCarte?.trim()) throw new BadRequestException('numeroCarte est requis.');
    const ctx = await this.contexte(user);
    const trouve = await this.charger(ctx, numeroCarte.trim());
    if (!trouve) {
      await this.audit('RECHERCHE_CARTE_INTROUVABLE', 'etablissements_sante', ctx.etablissementId, ctx, { numeroCarte: numeroCarte.trim().slice(0, 40) });
      throw new NotFoundException('Aucune carte trouvée pour ce numéro.');
    }
    const membre = trouve.adherent ?? trouve.beneficiaire!;
    const t = trouve.titulaire;
    const etab = await this.prisma.etablissementSante.findFirst({
      where: { id: ctx.etablissementId, organisationId: ctx.organisationId, deletedAt: null },
      select: { statut: true },
    });
    const { mention, motifs } = this.mention(membre.statut, t, etab?.statut === 'ACTIF');
    const canaux = this.notifications.canauxDisponibles();
    const liste: { canal: 'EMAIL' | 'SMS'; masque: string; actif: boolean; avertissement: string | null }[] = [];
    if (t.email) liste.push({ canal: 'EMAIL', masque: masquerEmail(t.email), actif: canaux.EMAIL.actif, avertissement: canaux.EMAIL.raison ?? null });
    if (t.telephone) liste.push({ canal: 'SMS', masque: masquerTelephone(t.telephone), actif: canaux.SMS.actif, avertissement: canaux.SMS.raison ?? null });
    await this.audit('CONSULTATION_FICHE_CARTE_ACCUEIL', trouve.adherent ? 'adherents' : 'beneficiaires', membre.id, ctx, {
      etablissementId: ctx.etablissementId,
      mention,
    });
    return {
      type: trouve.adherent ? ('ADHERENT_TITULAIRE' as const) : ('BENEFICIAIRE' as const),
      nom: membre.nom,
      prenom: membre.prenom,
      numeroCarte: membre.numeroCarte,
      dateNaissance: membre.dateNaissance.toISOString().slice(0, 10),
      sexe: membre.sexe ?? null,
      lien: trouve.beneficiaire ? trouve.beneficiaire.lienParente : 'TITULAIRE',
      photoUrl: await this.adherents.urlPhotoSignee(membre.photoUrl),
      societe: t.souscripteur.nom,
      souscripteur: { nom: t.souscripteur.nom, type: t.souscripteur.type },
      police: t.police ? { numero: t.police.numeroPolice } : null,
      produit: t.police ? t.police.produit.nom : null,
      carte: { mention, active: mention === 'ACTIVE', motifs },
      // contacts ENREGISTRÉS sur la fiche (ceux du titulaire pour un bénéficiaire), masqués — jamais saisis à l'accueil
      contacts: { source: trouve.adherent ? ('MEMBRE' as const) : ('TITULAIRE' as const), liste },
    };
  }

  /**
   * Émission du code depuis l'accueil : déclenchée par le choix du type d'acte, envoyée au contact ENREGISTRÉ du canal choisi.
   * Le code n'est jamais renvoyé à l'accueil (le patient le lit et le communique).
   */
  async emettreCode(user: AuthenticatedUser, dto: { numeroCarte: string; categorieActe: string; canal: CanalCode }) {
    const ctx = await this.contexte(user);
    const refuser = async (exc: HttpException, raison: string): Promise<never> => {
      await this.audit('REFUS_EMISSION_CODE_ACCUEIL', 'etablissements_sante', ctx.etablissementId, ctx, {
        numeroCarte: dto.numeroCarte.slice(0, 40),
        categorieActe: dto.categorieActe,
        canal: dto.canal,
        raison,
      }).catch(() => undefined);
      throw exc;
    };
    const trouve = await this.charger(ctx, dto.numeroCarte.trim());
    if (!trouve) return refuser(new NotFoundException('Aucune carte trouvée pour ce numéro.'), 'carte introuvable');
    const membre = trouve.adherent ?? trouve.beneficiaire!;
    const t = trouve.titulaire;

    const etab = await this.prisma.etablissementSante.findFirst({
      where: { id: ctx.etablissementId, organisationId: ctx.organisationId, deletedAt: null },
      select: { statut: true, nom: true },
    });
    const { mention, motifs } = this.mention(membre.statut, t, etab?.statut === 'ACTIF');
    if (mention !== 'ACTIVE') {
      return refuser(new ConflictException({ message: `Carte ${mention} : aucune consultation ne peut être ouverte.`, blocages: motifs }), `carte ${mention}`);
    }
    const categorie = (await this.categories.actives()).find((c) => c.code === dto.categorieActe);
    if (!categorie) return refuser(new BadRequestException('Type d’acte inconnu ou désactivé.'), 'type d’acte inconnu');

    // Contact ENREGISTRÉ du canal choisi — la valeur vient de la fiche, jamais du client.
    const destinataire = dto.canal === 'EMAIL' ? t.email : t.telephone;
    if (!destinataire) {
      return refuser(
        new ConflictException(dto.canal === 'EMAIL' ? 'Aucune adresse e-mail n’est enregistrée sur la fiche.' : 'Aucun numéro de téléphone n’est enregistré sur la fiche.'),
        `contact ${dto.canal} absent`,
      );
    }
    if (dto.canal === 'SMS' && !this.notifications.smsActif()) {
      return refuser(new ConflictException('SMS indisponible : fournisseur non configuré.'), 'SMS non configuré');
    }

    const policeId = t.policeId!;
    const evaluation = await this.careEpisode.evaluerEligibilite(ctx.organisationId, {
      adherentId: trouve.adherent?.id,
      beneficiaireId: trouve.beneficiaire?.id,
      etablissementId: ctx.etablissementId,
      policeId,
    });
    if (evaluation.blocages.length > 0) {
      return refuser(
        new ConflictException({ message: "Impossible d'émettre un code : conditions d'éligibilité non réunies.", blocages: evaluation.blocages }),
        'éligibilité',
      );
    }

    const recents = await this.prisma.codeConsultation.count({
      where: {
        etablissementId: ctx.etablissementId,
        emisPar: { not: null },
        createdAt: { gte: new Date(Date.now() - 3600_000) },
        ...(trouve.adherent ? { adherentId: trouve.adherent.id } : { beneficiaireId: trouve.beneficiaire!.id }),
      },
    });
    if (recents >= MAX_EMISSIONS_PAR_HEURE) {
      return refuser(
        new HttpException(`Trop d’envois pour ce patient (${MAX_EMISSIONS_PAR_HEURE} par heure). Réessayez plus tard.`, HttpStatus.TOO_MANY_REQUESTS),
        'limite horaire',
      );
    }

    const cree = await this.preauth.emettreCodeAccueil(ctx, {
      adherentId: trouve.adherent?.id ?? null,
      beneficiaireId: trouve.beneficiaire?.id ?? null,
      policeId,
      categorieActe: categorie.code,
      canal: dto.canal,
    });
    const envoi = await this.notifications.envoyer(dto.canal, destinataire, cree.code, etab?.nom ?? 'Établissement', categorie.libelle);
    await this.prisma.codeConsultation.update({ where: { id: cree.id }, data: { envoiStatut: envoi.statut, envoiDetail: envoi.detail } });
    await this.audit('ENVOI_CODE_CONSULTATION_ACCUEIL', 'codes_consultation', cree.id, ctx, {
      canal: dto.canal,
      statut: envoi.statut,
      categorieActe: categorie.code,
    });
    return {
      id: cree.id,
      statut: envoi.statut,
      canal: dto.canal,
      destinataire: dto.canal === 'EMAIL' ? masquerEmail(destinataire) : masquerTelephone(destinataire),
      typeActe: categorie.libelle,
      etablissement: etab?.nom ?? null,
      expireLe: cree.dateExpiration,
      message:
        envoi.statut === 'ENVOYE'
          ? 'Code envoyé au patient. Demandez-lui de vous le communiquer pour ouvrir la consultation.'
          : envoi.statut === 'NON_ENVOYE_DESACTIVE'
            ? 'Envoi réel désactivé : le code n’a pas été transmis. Le patient le retrouve dans son application.'
            : 'L’envoi a échoué. Le patient peut retrouver le code dans son application, ou réessayez.',
    };
  }
}
