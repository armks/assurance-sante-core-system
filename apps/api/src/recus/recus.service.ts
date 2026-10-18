import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_PHARMACIE } from '../pharmacy/pharmacy.types';
import { ROLES_CENTRE_MEDICAL, ROLES_GENERATION_FACTURE } from '../preauthorization/preauthorization.types';
import type { ParametresImpressionDto } from './recus.dto';
import { genererRecuPdf, type DonneesRecu, type TypeImprimante } from './recu-pdf';

/** Personnel d'un centre médical qui encaisse / facture ; l'assureur n'émet pas les reçus de caisse de l'établissement. */
const ROLES_CAISSE_CENTRE = ROLES_GENERATION_FACTURE.filter((r) => (ROLES_CENTRE_MEDICAL as readonly string[]).includes(r));

type Lieu = { type: 'ETABLISSEMENT' | 'PHARMACIE'; id: string };

const PARAMETRES_PAR_DEFAUT = {
  typeImprimante: 'A4' as TypeImprimante,
  enTete: null as string | null,
  piedPage: null as string | null,
  identifiantFiscal: null as string | null,
  afficherDetail: true,
};

interface Emetteur {
  nom: string;
  code: string;
  adresseComplete: string | null;
  quartier: string | null;
  commune: string | null;
  ville: string | null;
  telephone: string | null;
}

@Injectable()
export class RecusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  // ---------------------------------------------------------------- paramétrage

  async lireParametres(user: AuthenticatedUser) {
    const ctx = await this.contexte(user);
    return this.parametresDe(ctx.lieu, ctx.organisationId);
  }

  async enregistrerParametres(user: AuthenticatedUser, dto: ParametresImpressionDto) {
    const ctx = await this.contexte(user);
    const donnees = {
      typeImprimante: dto.typeImprimante,
      enTete: dto.enTete ?? null,
      piedPage: dto.piedPage ?? null,
      identifiantFiscal: dto.identifiantFiscal ?? null,
      afficherDetail: dto.afficherDetail,
      updatedBy: ctx.userId,
    };
    const cle = ctx.lieu.type === 'ETABLISSEMENT' ? { etablissementId: ctx.lieu.id } : { pharmacieId: ctx.lieu.id };
    const existant = await this.prisma.parametreImpression.findFirst({ where: cle, select: { id: true } });
    if (existant) await this.prisma.parametreImpression.update({ where: { id: existant.id }, data: donnees });
    else await this.prisma.parametreImpression.create({ data: { organisationId: ctx.organisationId, ...cle, ...donnees } });
    await this.audit(ctx.userId, 'PARAMETRAGE_IMPRESSION', ctx.lieu.id, { imprimante: dto.typeImprimante, detail: dto.afficherDetail });
    return this.parametresDe(ctx.lieu, ctx.organisationId);
  }

  // ---------------------------------------------------------------- reçu d'une facture de soins

  async recuFactureSoins(user: AuthenticatedUser, factureId: string, imprimante?: TypeImprimante) {
    const ctx = await this.contexte(user);
    if (ctx.lieu.type !== 'ETABLISSEMENT') throw new ForbiddenException('Le reçu d’une facture de soins est émis par l’établissement sanitaire.');
    const f = await this.prisma.factureDossier.findFirst({
      where: { id: factureId, organisationId: ctx.organisationId, etablissementId: ctx.lieu.id, deletedAt: null },
      include: {
        etablissement: { select: { nom: true, code: true, adresseComplete: true, quartier: true, commune: true, ville: true, telephone: true } },
        adherent: { select: { nom: true, prenom: true, numeroCarte: true } },
        beneficiaire: { select: { nom: true, prenom: true, numeroCarte: true, lienParente: true } },
        dossier: { select: { numeroTraitement: true, police: { select: { souscripteur: { select: { nom: true } } } } } },
        lignesFacturation: {
          include: { acteDossier: { select: { libelle: true, quantite: true, montantPrescrit: true, montantSimulePatient: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!f) throw new NotFoundException('Facture introuvable.');
    if (!f.codeValideParPatient) {
      throw new ConflictException('Le reçu de caisse n’est émis qu’une fois la part du patient réglée : le patient doit d’abord valider son code de facturation.');
    }
    const datePaiement = f.dateValidationPatient ?? f.dateReglement ?? f.updatedAt;
    const montant = Number(f.montantPatient);
    const rang = await this.prisma.factureDossier.count({ where: { dossierSoinsId: f.dossierSoinsId, deletedAt: null, createdAt: { lte: f.createdAt } } });
    const patient = f.beneficiaire
      ? { nom: `${f.beneficiaire.prenom} ${f.beneficiaire.nom}`, numeroCarte: f.beneficiaire.numeroCarte, lien: f.beneficiaire.lienParente }
      : { nom: `${f.adherent?.prenom ?? ''} ${f.adherent?.nom ?? ''}`.trim() || '—', numeroCarte: f.adherent?.numeroCarte ?? null, lien: 'TITULAIRE' };
    const recu = await this.recuPour({ factureId: f.id }, { organisationId: ctx.organisationId, lieu: ctx.lieu, code: f.etablissement.code, montant, datePaiement, userId: ctx.userId });
    const donnees = await this.assembler(ctx, recu, imprimante, {
      emetteur: f.etablissement,
      patient: { ...patient, societe: f.dossier.police.souscripteur.nom },
      reference: { libelle: 'Facture de soins', numero: `F-${f.dossier.numeroTraitement}-${String(rang).padStart(2, '0')}`, dossier: f.dossier.numeroTraitement },
      lignes: f.lignesFacturation.map((l) => ({
        libelle: l.acteDossier.libelle,
        quantite: l.acteDossier.quantite,
        prixUnitaire: Number(l.acteDossier.montantPrescrit ?? 0),
        montantPatient: Number(l.acteDossier.montantSimulePatient ?? 0),
      })),
      totaux: { total: Number(f.montantTotal), assurance: Number(f.montantAssurance), patient: montant },
      mode: 'part du patient réglée - code de facturation validé par le patient',
      datePaiement,
    });
    return this.tirer(ctx, recu, donnees);
  }

  // ---------------------------------------------------------------- reçu d'une dispensation de médicaments

  async recuDispensation(user: AuthenticatedUser, dispensationId: string, imprimante?: TypeImprimante) {
    const ctx = await this.contexte(user);
    if (ctx.lieu.type !== 'PHARMACIE') throw new ForbiddenException('Le reçu d’une dispensation est émis par la pharmacie.');
    const d = await this.prisma.dispensationPharmacie.findFirst({
      where: { id: dispensationId, pharmacieId: ctx.lieu.id, organisationId: ctx.organisationId },
      include: {
        pharmacie: { select: { nom: true, code: true, adresseComplete: true, quartier: true, commune: true, ville: true, telephone: true } },
        lignes: { include: { ligneOrdonnance: { select: { denominationMedicament: true } } }, orderBy: { id: 'asc' } },
        ordonnance: {
          select: {
            dossier: {
              select: {
                numeroTraitement: true,
                adherent: { select: { nom: true, prenom: true, numeroCarte: true } },
                beneficiaire: { select: { nom: true, prenom: true, numeroCarte: true, lienParente: true } },
                police: { select: { souscripteur: { select: { nom: true } } } },
              },
            },
          },
        },
      },
    });
    if (!d) throw new NotFoundException('Dispensation introuvable.');
    if (d.statut !== 'PAYEE') throw new ConflictException('Le reçu de caisse n’est émis qu’une fois la dispensation réglée par le patient.');
    const dossier = d.ordonnance.dossier;
    const lignes = d.lignes.map((l) => ({
      libelle: l.ligneOrdonnance.denominationMedicament,
      quantite: l.quantite,
      prixUnitaire: Number(l.prixUnitaire),
      montantPatient: Number(l.montantPatient),
      montant: Number(l.montantLigne),
      assurance: Number(l.montantAssurance),
    }));
    const patient = dossier.beneficiaire
      ? { nom: `${dossier.beneficiaire.prenom} ${dossier.beneficiaire.nom}`, numeroCarte: dossier.beneficiaire.numeroCarte, lien: dossier.beneficiaire.lienParente }
      : { nom: `${dossier.adherent?.prenom ?? ''} ${dossier.adherent?.nom ?? ''}`.trim() || '—', numeroCarte: dossier.adherent?.numeroCarte ?? null, lien: 'TITULAIRE' };
    const montant = lignes.reduce((s, l) => s + l.montantPatient, 0);
    const datePaiement = d.datePaiement ?? d.dateValidationPatient ?? d.createdAt;
    const recu = await this.recuPour({ dispensationId: d.id }, { organisationId: ctx.organisationId, lieu: ctx.lieu, code: d.pharmacie.code, montant, datePaiement, userId: ctx.userId });
    const donnees = await this.assembler(ctx, recu, imprimante, {
      emetteur: d.pharmacie,
      patient: { ...patient, societe: dossier.police.souscripteur.nom },
      reference: { libelle: 'Facture de médicaments', numero: `P-${dossier.numeroTraitement}-${d.id.slice(0, 6).toUpperCase()}`, dossier: dossier.numeroTraitement },
      lignes: lignes.map(({ libelle, quantite, prixUnitaire, montantPatient }) => ({ libelle, quantite, prixUnitaire, montantPatient })),
      totaux: { total: lignes.reduce((s, l) => s + l.montant, 0), assurance: lignes.reduce((s, l) => s + l.assurance, 0), patient: montant },
      mode: 'règlement de la part du patient confirmé en caisse après validation de son code',
      datePaiement,
    });
    return this.tirer(ctx, recu, donnees);
  }

  // ---------------------------------------------------------------- interne

  /** Reçu unique par facture / dispensation : créé au premier tirage (numérotation continue), jamais recréé. */
  private async recuPour(
    source: { factureId: string } | { dispensationId: string },
    p: { organisationId: string; lieu: Lieu; code: string; montant: number; datePaiement: Date; userId: string },
  ) {
    const trouver = () => this.prisma.recuCaisse.findUnique({ where: source });
    const existant = await trouver();
    if (existant) return existant;
    const [{ seq }] = await this.prisma.$queryRaw<{ seq: number }[]>`select nextval(pg_get_serial_sequence('public.recus_caisse', 'numero_seq'))::int as seq`;
    try {
      return await this.prisma.recuCaisse.create({
        data: {
          organisationId: p.organisationId,
          ...(p.lieu.type === 'ETABLISSEMENT' ? { etablissementId: p.lieu.id } : { pharmacieId: p.lieu.id }),
          ...source,
          numeroSeq: seq,
          numero: `R-${p.code}-${String(seq).padStart(6, '0')}`,
          montantPaye: new Prisma.Decimal(p.montant.toFixed(2)),
          datePaiement: p.datePaiement,
          emisPar: p.userId,
        },
      });
    } catch (err) {
      // deux tirages simultanés : l'autre a créé le reçu
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const cree = await trouver();
        if (cree) return cree;
      }
      throw err;
    }
  }

  private async assembler(
    ctx: { userId: string; organisationId: string; lieu: Lieu },
    recu: { numero: string; montantPaye: Prisma.Decimal; nombreImpressions: number },
    imprimante: TypeImprimante | undefined,
    x: {
      emetteur: Emetteur;
      patient: DonneesRecu['patient'];
      reference: DonneesRecu['reference'];
      lignes: DonneesRecu['lignes'];
      totaux: DonneesRecu['totaux'];
      mode: string;
      datePaiement: Date;
    },
  ): Promise<DonneesRecu> {
    const [param, profil] = await Promise.all([
      this.parametresDe(ctx.lieu, ctx.organisationId),
      this.prisma.profil.findUnique({ where: { id: ctx.userId }, select: { pseudo: true } }),
    ]);
    const adresse = [x.emetteur.adresseComplete ?? [x.emetteur.quartier, x.emetteur.commune].filter(Boolean).join(', '), x.emetteur.ville].filter(Boolean).join(', ');
    return {
      imprimante: imprimante ?? param.typeImprimante,
      emetteur: { nom: x.emetteur.nom, code: x.emetteur.code, adresse: adresse || null, telephone: x.emetteur.telephone, identifiantFiscal: param.identifiantFiscal },
      enTete: param.enTete,
      pied: param.piedPage,
      afficherDetail: param.afficherDetail,
      numero: recu.numero,
      emisLe: new Date(),
      duplicata: recu.nombreImpressions,
      patient: x.patient,
      reference: x.reference,
      lignes: x.lignes,
      totaux: x.totaux,
      paiement: { montant: Number(recu.montantPaye), date: x.datePaiement, mode: x.mode },
      caissier: profil?.pseudo ?? 'caisse',
    };
  }

  private async tirer(ctx: { userId: string }, recu: { id: string; numero: string }, donnees: DonneesRecu) {
    const buffer = await genererRecuPdf(donnees);
    await this.prisma.recuCaisse.update({ where: { id: recu.id }, data: { nombreImpressions: { increment: 1 }, derniereImpression: new Date() } });
    await this.audit(ctx.userId, 'EMISSION_RECU_CAISSE', recu.id, { numero: recu.numero, imprimante: donnees.imprimante, duplicata: donnees.duplicata });
    return { buffer, nomFichier: `recu-${recu.numero}.pdf`, type: 'application/pdf' as const };
  }

  private async parametresDe(lieu: Lieu, organisationId: string) {
    const p = await this.prisma.parametreImpression.findFirst({
      where: { organisationId, ...(lieu.type === 'ETABLISSEMENT' ? { etablissementId: lieu.id } : { pharmacieId: lieu.id }) },
    });
    if (!p) return { ...PARAMETRES_PAR_DEFAUT };
    return {
      typeImprimante: p.typeImprimante as TypeImprimante,
      enTete: p.enTete,
      piedPage: p.piedPage,
      identifiantFiscal: p.identifiantFiscal,
      afficherDetail: p.afficherDetail,
    };
  }

  /** Lieu de l'appelant : son établissement (caisse du centre médical) ou sa pharmacie. */
  private async contexte(user: AuthenticatedUser): Promise<{ userId: string; organisationId: string; lieu: Lieu }> {
    const { profil, permissions } = await this.identity.getMe(user);
    if (!profil.organisationId) throw new ForbiddenException('Ce compte n’est rattaché à aucune organisation.');
    const chaine = permissions?.roleChain ?? [];
    const estCentre = chaine.some((r) => (ROLES_CAISSE_CENTRE as readonly string[]).includes(r));
    const estPharmacie = chaine.some((r) => (ROLES_PHARMACIE as readonly string[]).includes(r));
    if (estCentre && profil.etablissementId) return { userId: profil.id, organisationId: profil.organisationId, lieu: { type: 'ETABLISSEMENT', id: profil.etablissementId } };
    if (estPharmacie && profil.pharmacieId) return { userId: profil.id, organisationId: profil.organisationId, lieu: { type: 'PHARMACIE', id: profil.pharmacieId } };
    throw new ForbiddenException('Réservé à la caisse d’un établissement sanitaire ou d’une pharmacie.');
  }

  private async audit(userId: string, action: string, enregistrementId: string, details: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.$executeRaw`
      SELECT log_audit(${action}::text, ${'recus_caisse'}::text, ${enregistrementId}::uuid, ${userId}::uuid, ${JSON.stringify(details)}::jsonb)`;
  }
}
