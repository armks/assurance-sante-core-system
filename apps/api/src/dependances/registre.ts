/**
 * Registre des entités contrôlées par le service des dépendances (ADR-007) : pour
 * chacune, rôles, chargement DANS le périmètre du jeton, liens comptés (clés
 * étrangères ET liens logiques relevés par l'audit du 2026-10-08) et règles d'état
 * par action.
 *
 * Règles communes : chaque dépendance = UN `count` restreint à l'organisation de
 * l'appelant (le superadministrateur, sans organisation, voit le catalogue national et
 * les organisations) ; un enregistrement hors périmètre n'est jamais chargé (404, rien
 * n'est révélé). Une dépendance bloque la SUPPRESSION par défaut ; certaines bloquent
 * aussi l'archivage (dossiers ouverts, factures non réglées…).
 *
 * Rôles dupliqués depuis les modules métier (un module = un domaine strict).
 */
import type {
  ContexteDependances,
  Db,
  DefinitionDependance,
  DefinitionEntite,
} from './dependances.types';

// --- Rôles (miroir des constantes des modules) ---------------------------------
const SUPERADMIN = ['SUPERADMIN_PRINCIPAL'] as const;
const GESTION_SOUSCRIPTEUR = ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE', 'ASSUREUR_COMPTABLE'] as const;
const GESTION_RESEAU = ['ASSUREUR_INFORMATIQUE'] as const;
const GESTION_PLAN = ['ASSUREUR_DIRECTION', 'ASSUREUR_INFORMATIQUE'] as const;
const GESTION_POLICE = ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'] as const;
const GESTION_MEMBRE = ['ASSUREUR_DIRECTION', 'ASSUREUR_EXPLOITATION', 'ASSUREUR_INFORMATIQUE'] as const;
const GESTION_REFERENTIEL_ACTES = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_MEDECIN_CONSEIL'] as const;
const GESTION_REFERENTIEL_MEDICAMENTS = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_PHARMACIEN_CONSEIL'] as const;
const GESTION_UTILISATEURS = ['ASSUREUR_INFORMATIQUE'] as const;
const GESTION_COMPTES = ['ASSUREUR_COMPTABLE'] as const;
const ROLE_SOCIETE_MEMBRES = 'SOCIETE_ADMINISTRATION';

// --- Aides ------------------------------------------------------------------------
/** Organisation du périmètre (jamais null pour une entité d'organisation). */
const org = (ctx: ContexteDependances) => ctx.organisationId ?? '00000000-0000-0000-0000-000000000000';

const dep = <R>(
  cle: string,
  singulier: string,
  pluriel: string,
  compter: DefinitionDependance<R>['compter'],
  bloque?: DefinitionDependance<R>['bloque'],
): DefinitionDependance<R> => ({ cle, singulier, pluriel, compter, ...(bloque ? { bloque } : {}) });

const NON_DISPONIBLE = undefined;
const dejaArchive = (designation: string) => `${designation} est déjà archivé(e).`;

/** Dates de soins d'un acte dans [debut, fin] — réalisation, à défaut prescription. */
const acteDansPeriode = (debut: Date, fin: Date | null) => {
  const borne = { gte: debut, ...(fin ? { lt: new Date(fin.getTime() + 86_400_000) } : {}) };
  return { OR: [{ dateRealisation: borne }, { dateRealisation: null, datePrescription: borne }] };
};

// --- Registre ------------------------------------------------------------------------
export const REGISTRE: Record<string, DefinitionEntite> = {
  organisation: {
    designation: "l'organisation",
    pronom: 'la',
    table: 'organisations',
    roles: SUPERADMIN,
    charger: (db, id) => db.organisation.findFirst({ where: { id, deletedAt: null } }),
    nom: (o) => o.nom,
    dependances: [
      dep('utilisateurs', 'utilisateur', 'utilisateurs', (db, o) => db.profil.count({ where: { organisationId: o.id, deletedAt: null } })),
      dep('souscripteurs', 'société cliente', 'sociétés clientes', (db, o) => db.souscripteur.count({ where: { organisationId: o.id, deletedAt: null } })),
      dep('produits', 'produit', 'produits', (db, o) => db.produit.count({ where: { organisationId: o.id, deletedAt: null } })),
      dep('polices', 'police', 'polices', (db, o) => db.police.count({ where: { organisationId: o.id } })),
      dep('etablissements', 'établissement de santé', 'établissements de santé', (db, o) => db.etablissementSante.count({ where: { organisationId: o.id, deletedAt: null } })),
      dep('pharmacies', 'pharmacie', 'pharmacies', (db, o) => db.pharmacie.count({ where: { organisationId: o.id, deletedAt: null } })),
      dep('adherents', 'adhérent', 'adhérents', (db, o) => db.adherent.count({ where: { organisationId: o.id } })),
      dep('policesActives', 'police active', 'polices actives', (db, o) => db.police.count({ where: { organisationId: o.id, statut: 'ACTIVE' } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (o) => (o.statut === 'ARCHIVEE' ? dejaArchive("L'organisation") : null),
      desarchiver: (o) => (o.statut !== 'ARCHIVEE' ? "L'organisation n'est pas archivée." : null),
      modifier: (o) => (o.statut === 'ARCHIVEE' ? "L'organisation est archivée : désarchivez-la d'abord." : null),
    },
  },

  souscripteur: {
    designation: 'la société cliente',
    pronom: 'la',
    table: 'souscripteurs',
    roles: GESTION_SOUSCRIPTEUR,
    charger: (db, id, ctx) => db.souscripteur.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (s) => s.nom,
    dependances: [
      dep('adherents', 'adhérent', 'adhérents', (db, s, ctx) => db.adherent.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('polices', 'police', 'polices', (db, s, ctx) => db.police.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('cotisations', 'cotisation', 'cotisations', (db, s) => db.cotisation.count({ where: { societeId: s.id } })),
      dep('grilles', 'grille tarifaire', 'grilles tarifaires', (db, s, ctx) => db.grilleTarifaire.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('imports', "import d'adhérents", "imports d'adhérents", (db, s, ctx) => db.importAdherents.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('questionnaires', 'questionnaire médical', 'questionnaires médicaux', (db, s) => db.questionnaireMedical.count({ where: { souscripteurId: s.id } })),
      dep('membresComite', 'membre du comité de gestion', 'membres du comité de gestion', (db, s) => db.membreComiteGestion.count({ where: { souscripteurId: s.id, deletedAt: null } })),
      dep('plansPaiement', 'plan de paiement', 'plans de paiement', (db, s) => db.planPaiementCollectivite.count({ where: { souscripteurId: s.id } })),
      // liens LOGIQUES (sans clé étrangère) relevés par l'audit
      dep('utilisateurs', 'compte utilisateur', 'comptes utilisateurs', (db, s, ctx) => db.profil.count({ where: { societeId: s.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, s, ctx) => db.invitation.count({ where: { societeId: s.id, organisationId: org(ctx) } })),
    ],
    regles: { supprimer: () => null, modifier: () => null },
  },

  utilisateur: {
    designation: 'le compte utilisateur',
    pronom: 'le',
    table: 'profils',
    roles: GESTION_UTILISATEURS,
    charger: (db, id, ctx) => db.profil.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (p) => `${p.role ?? 'sans rôle'} (${String(p.id).slice(0, 8)})`,
    dependances: [
      dep('lignesAudit', "ligne d'historique (audit)", "lignes d'historique (audit)", (db, p, ctx) => db.auditLog.count({ where: { userId: p.id, organisationId: org(ctx) } })),
      dep('consultations', 'consultation', 'consultations', (db, p) => db.consultationDossier.count({ where: { medecinId: p.id } })),
      dep('actesPrescrits', 'acte prescrit', 'actes prescrits', (db, p) => db.acteDossier.count({ where: { medecinPrescripteurId: p.id } })),
      dep('ordonnances', 'ordonnance', 'ordonnances', (db, p, ctx) => db.ordonnance.count({ where: { medecinId: p.id, organisationId: org(ctx) } })),
      dep('dispensations', 'dispensation', 'dispensations', (db, p) => db.dispensationPharmacie.count({ where: { caissiereId: p.id } })),
      dep('notes', 'note de dossier', 'notes de dossier', (db, p, ctx) => db.noteDossier.count({ where: { auteurId: p.id, organisationId: org(ctx) } })),
      dep('invitationsEnvoyees', 'invitation envoyée', 'invitations envoyées', (db, p, ctx) => db.invitation.count({ where: { invitePar: p.id, organisationId: org(ctx) } })),
      dep('mouvements', 'mouvement financier', 'mouvements financiers', (db, p, ctx) => db.mouvementFinancier.count({ where: { effectueParId: p.id, organisationId: org(ctx) } })),
      dep('avenants', 'avenant', 'avenants', (db, p) => db.avenant.count({ where: { creePar: p.id } })),
    ],
    regles: {
      supprimer: (p, ctx) => (p.id === ctx.userId ? 'Vous ne pouvez pas supprimer votre propre compte.' : null),
      modifier: () => null,
    },
  },

  invitation: {
    designation: "l'invitation",
    pronom: 'la',
    table: 'invitations',
    roles: GESTION_UTILISATEURS,
    charger: (db, id, ctx) => db.invitation.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (i) => i.email,
    dependances: [],
    regles: {
      supprimer: () => "Une invitation n'est jamais supprimée : elle reste dans l'historique des accès. Révoquez-la si elle est encore en attente.",
    },
  },

  etablissement: {
    designation: "l'établissement de santé",
    pronom: 'le',
    table: 'etablissements_sante',
    roles: GESTION_RESEAU,
    charger: (db, id, ctx) => db.etablissementSante.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (e) => e.nom,
    dependances: [
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, e, ctx) => db.dossierSoins.count({ where: { organisationId: org(ctx), OR: [{ etablissementId: e.id }, { transfereVers: e.id }] } })),
      dep('actesExecutes', 'acte exécuté', 'actes exécutés', (db, e) => db.acteDossier.count({ where: { etablissementExecutionId: e.id } })),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, e, ctx) => db.codeConsultation.count({ where: { etablissementId: e.id, organisationId: org(ctx) } })),
      dep('factures', 'facture', 'factures', (db, e, ctx) => db.factureDossier.count({ where: { etablissementId: e.id, organisationId: org(ctx) } })),
      dep('facturesMensuelles', 'facture mensuelle', 'factures mensuelles', (db, e, ctx) => db.factureMensuelleEtablissement.count({ where: { etablissementId: e.id, organisationId: org(ctx) } })),
      dep('tarifs', 'tarif conventionné', 'tarifs conventionnés', (db, e, ctx) => db.tarifConventionne.count({ where: { etablissementId: e.id, organisationId: org(ctx), deletedAt: null } })),
      dep('utilisateurs', 'compte utilisateur', 'comptes utilisateurs', (db, e, ctx) => db.profil.count({ where: { etablissementId: e.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, e, ctx) => db.invitation.count({ where: { etablissementId: e.id, organisationId: org(ctx) } })),
      // bloquent aussi l'ARCHIVAGE : activité en cours
      dep('dossiersOuverts', 'dossier de soins ouvert', 'dossiers de soins ouverts', (db, e, ctx) => db.dossierSoins.count({ where: { organisationId: org(ctx), etablissementId: e.id, statut: 'OUVERT' } }), ['archiver']),
      dep('facturesNonReglees', 'facture non réglée', 'factures non réglées', (db, e, ctx) => db.factureDossier.count({ where: { etablissementId: e.id, organisationId: org(ctx), statut: { not: 'REGLEE' } } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (e) => (e.statut === 'RESILIE' ? dejaArchive("L'établissement") : null),
      desarchiver: (e) => (e.statut !== 'RESILIE' ? "L'établissement n'est pas archivé." : null),
      modifier: (e) => (e.statut === 'RESILIE' ? "L'établissement est archivé : désarchivez-le d'abord." : null),
    },
  },

  pharmacie: {
    designation: 'la pharmacie',
    pronom: 'la',
    table: 'pharmacies',
    roles: GESTION_RESEAU,
    charger: (db, id, ctx) => db.pharmacie.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (p) => p.nom,
    dependances: [
      dep('dispensations', 'dispensation', 'dispensations', (db, p) => db.dispensationPharmacie.count({ where: { pharmacieId: p.id } })),
      dep('facturesMensuelles', 'facture mensuelle', 'factures mensuelles', (db, p, ctx) => db.factureMensuellePharmacie.count({ where: { pharmacieId: p.id, organisationId: org(ctx) } })),
      dep('lignesServies', "ligne d'ordonnance servie", "lignes d'ordonnance servies", (db, p) => db.ligneOrdonnance.count({ where: { pharmacieServanteId: p.id } })),
      dep('codesOrdonnance', "code d'ordonnance", "codes d'ordonnance", (db, p, ctx) => db.codeOrdonnance.count({ where: { pharmacieUtilisatriceId: p.id, organisationId: org(ctx) } })),
      dep('stock', 'article en stock', 'articles en stock', (db, p) => db.stockMedicamentPharmacie.count({ where: { pharmacieId: p.id } })),
      dep('tarifs', 'tarif conventionné', 'tarifs conventionnés', (db, p, ctx) => db.tarifConventionne.count({ where: { pharmacieId: p.id, organisationId: org(ctx), deletedAt: null } })),
      dep('utilisateurs', 'compte utilisateur', 'comptes utilisateurs', (db, p, ctx) => db.profil.count({ where: { pharmacieId: p.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, p, ctx) => db.invitation.count({ where: { pharmacieId: p.id, organisationId: org(ctx) } })),
      dep('dispensationsEnCours', 'dispensation en cours', 'dispensations en cours', (db, p) => db.dispensationPharmacie.count({ where: { pharmacieId: p.id, statut: { notIn: ['PAYEE', 'ANNULEE'] } } }), ['archiver']),
      dep('facturesMensuellesNonPayees', 'facture mensuelle non payée', 'factures mensuelles non payées', (db, p, ctx) => db.factureMensuellePharmacie.count({ where: { pharmacieId: p.id, organisationId: org(ctx), statut: { not: 'PAYEE' } } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (p) => (p.statut === 'RESILIEE' ? dejaArchive('La pharmacie') : null),
      desarchiver: (p) => (p.statut !== 'RESILIEE' ? "La pharmacie n'est pas archivée." : null),
      modifier: (p) => (p.statut === 'RESILIEE' ? "La pharmacie est archivée : désarchivez-la d'abord." : null),
    },
  },

  tarif: {
    designation: 'le tarif conventionné',
    pronom: 'le',
    table: 'tarifs_conventionnes',
    roles: GESTION_RESEAU,
    charger: (db, id, ctx) =>
      db.tarifConventionne.findFirst({
        where: { id, organisationId: org(ctx), deletedAt: null },
        include: { referentielActe: { select: { code: true, libelle: true } } },
      }),
    nom: (t) => `${t.referentielActe?.libelle ?? 'acte'} — ${Number(t.tarifConvention).toLocaleString('fr-FR')} F`,
    dependances: [
      // lien LOGIQUE : actes de l'établissement, de ce code, dont la date des soins
      // tombe dans la période du tarif — c'est-à-dire calculés avec ce tarif
      dep('actesCalcules', 'acte calculé avec ce tarif', 'actes calculés avec ce tarif', (db, t, ctx) =>
        t.etablissementId
          ? db.acteDossier.count({
              where: {
                codeActe: t.referentielActe.code,
                deletedAt: null,
                dossier: { organisationId: org(ctx), etablissementId: t.etablissementId },
                ...acteDansPeriode(t.dateDebut, t.dateFin),
              },
            })
          : Promise.resolve(0),
        ['supprimer', 'modifier']),
      // un tarif fermé ne se rouvre pas si un tarif suivant a déjà pris le relais
      dep('tarifsSuivants', 'tarif suivant', 'tarifs suivants', (db, t, ctx) =>
        db.tarifConventionne.count({
          where: {
            id: { not: t.id },
            organisationId: org(ctx),
            referentielActeId: t.referentielActeId,
            deletedAt: null,
            ...(t.etablissementId ? { etablissementId: t.etablissementId } : { pharmacieId: t.pharmacieId }),
            dateDebut: { gt: t.dateDebut },
          },
        }),
        ['desarchiver']),
    ],
    regles: {
      supprimer: () => null,
      // archiver = FERMER le tarif (date de fin) ; désarchiver = le rouvrir
      archiver: (t) => (t.dateFin ? 'Le tarif est déjà fermé (date de fin renseignée).' : null),
      desarchiver: (t) => (!t.dateFin ? "Le tarif n'est pas fermé." : null),
      modifier: () => null,
    },
  },

  referentielActe: {
    designation: "l'acte du référentiel",
    pronom: 'le',
    table: 'referentiel_actes',
    roles: GESTION_REFERENTIEL_ACTES,
    charger: (db, id, ctx) => db.referentielActe.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (a) => `${a.code} — ${a.libelle}`,
    dependances: [
      dep('tarifs', 'tarif conventionné', 'tarifs conventionnés', (db, a, ctx) => db.tarifConventionne.count({ where: { referentielActeId: a.id, organisationId: org(ctx), deletedAt: null } })),
      // liens LOGIQUES par code d'acte
      dep('actes', 'acte de dossier', 'actes de dossier', (db, a, ctx) => db.acteDossier.count({ where: { codeActe: a.code, dossier: { organisationId: org(ctx) } } })),
      dep('autorisationsRepetition', 'autorisation de répétition', 'autorisations de répétition', (db, a, ctx) => db.autorisationRepetitionActe.count({ where: { codeActe: a.code, organisationId: org(ctx) } })),
    ],
    regles: {
      supprimer: (a) => (a.statut !== 'PROPOSE' ? "Seul un acte encore proposé (jamais homologué) peut être supprimé : retirez-le plutôt." : null),
      archiver: (a) => (a.statut === 'RETIRE' ? dejaArchive("L'acte") : null),
      desarchiver: (a) => (a.statut !== 'RETIRE' ? "L'acte n'est pas retiré." : null),
      modifier: (a) => (a.statut === 'RETIRE' ? "L'acte est retiré : reproposez-le d'abord." : null),
    },
  },

  medicament: {
    designation: 'le médicament',
    pronom: 'le',
    table: 'medicaments',
    roles: GESTION_REFERENTIEL_MEDICAMENTS,
    charger: (db, id, ctx) => db.medicament.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (m) => m.denominationCommune,
    dependances: [
      // liens LOGIQUES par dénomination (sans clé étrangère), insensibles à la casse
      dep('lignesOrdonnance', "ligne d'ordonnance", "lignes d'ordonnance", (db, m, ctx) => db.ligneOrdonnance.count({ where: { denominationMedicament: { equals: m.denominationCommune, mode: 'insensitive' }, ordonnance: { organisationId: org(ctx) } } })),
      dep('stocks', 'article en stock de pharmacie', 'articles en stock de pharmacie', (db, m, ctx) => db.stockMedicamentPharmacie.count({ where: { denominationMedicament: { equals: m.denominationCommune, mode: 'insensitive' }, pharmacie: { organisationId: org(ctx) } } })),
    ],
    regles: {
      supprimer: (m) => (m.statutHomologation !== 'PROPOSE' ? 'Seul un médicament encore proposé (jamais homologué) peut être supprimé : retirez-le plutôt.' : null),
      archiver: (m) => (m.statutHomologation === 'RETIRE' ? dejaArchive('Le médicament') : null),
      desarchiver: (m) => (m.statutHomologation !== 'RETIRE' ? "Le médicament n'est pas retiré." : null),
      modifier: (m) => (m.statutHomologation === 'RETIRE' ? "Le médicament est retiré : reproposez-le d'abord." : null),
    },
  },

  acteNational: {
    designation: "l'acte du catalogue national",
    pronom: 'le',
    table: 'referentiel_national_actes',
    roles: SUPERADMIN,
    charger: (db, id) => db.referentielNationalActe.findFirst({ where: { id, deletedAt: null } }),
    nom: (a) => `${a.code} — ${a.libelle}`,
    dependances: [
      // lien LOGIQUE : copies importées par les organisations (même code)
      dep('imports', 'organisation qui l’a importé', 'organisations qui l’ont importé', (db, a) => db.referentielActe.count({ where: { code: a.code, deletedAt: null } })),
    ],
    regles: {
      supprimer: () => null,
      archiver: (a) => (a.statut === 'RETIRE' ? dejaArchive("L'acte") : null),
      desarchiver: (a) => (a.statut !== 'RETIRE' ? "L'acte n'est pas retiré." : null),
      modifier: () => null,
    },
  },

  medicamentNational: {
    designation: 'le médicament du catalogue national',
    pronom: 'le',
    table: 'referentiel_national_medicaments',
    roles: SUPERADMIN,
    charger: (db, id) => db.referentielNationalMedicament.findFirst({ where: { id, deletedAt: null } }),
    nom: (m) => m.denominationCommune,
    dependances: [
      dep('imports', 'organisation qui l’a importé', 'organisations qui l’ont importé', (db, m) => db.medicament.count({ where: { denominationCommune: { equals: m.denominationCommune, mode: 'insensitive' }, deletedAt: null } })),
    ],
    regles: {
      supprimer: () => null,
      archiver: (m) => (m.statutHomologation === 'RETIRE' ? dejaArchive('Le médicament') : null),
      desarchiver: (m) => (m.statutHomologation !== 'RETIRE' ? "Le médicament n'est pas retiré." : null),
      modifier: () => null,
    },
  },

  produit: {
    designation: 'le produit',
    pronom: 'le',
    table: 'produits',
    roles: GESTION_PLAN,
    charger: (db, id, ctx) => db.produit.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (p) => `${p.nom} v${p.version}`,
    dependances: [
      dep('polices', 'police', 'polices', (db, p, ctx) => db.police.count({ where: { produitId: p.id, organisationId: org(ctx) } })),
      dep('garanties', 'garantie', 'garanties', (db, p) => db.garantie.count({ where: { produitId: p.id, deletedAt: null } })),
      dep('grilles', 'grille tarifaire', 'grilles tarifaires', (db, p, ctx) => db.grilleTarifaire.count({ where: { produitId: p.id, organisationId: org(ctx), deletedAt: null } })),
      // un produit archivé ne revient pas si une autre version du même nom est publiée
      dep('versionPubliee', 'autre version publiée', 'autres versions publiées', (db, p, ctx) => db.produit.count({ where: { organisationId: org(ctx), nom: p.nom, statut: 'PUBLIE', id: { not: p.id }, deletedAt: null } }), ['desarchiver']),
    ],
    regles: {
      supprimer: (p) => (p.statut !== 'BROUILLON' ? 'Seul un produit en brouillon peut être supprimé : archivez-le plutôt.' : null),
      archiver: (p) => (p.statut === 'ARCHIVE' ? dejaArchive('Le produit') : p.statut !== 'PUBLIE' ? 'Seul un produit publié peut être archivé (un brouillon se supprime).' : null),
      desarchiver: (p) => (p.statut !== 'ARCHIVE' ? "Le produit n'est pas archivé." : null),
      modifier: (p) => (p.statut !== 'BROUILLON' ? 'Un produit publié ou archivé ne se modifie pas : créez une nouvelle version.' : null),
    },
  },

  garantie: {
    designation: 'la garantie',
    pronom: 'la',
    table: 'garanties',
    roles: GESTION_PLAN,
    charger: (db, id, ctx) =>
      db.garantie.findFirst({
        where: { id, deletedAt: null, produit: { organisationId: org(ctx) } },
        include: { produit: { select: { nom: true, statut: true } } },
      }),
    nom: (g) => `${g.produit?.nom ?? ''} — ${g.categorieActe}`,
    dependances: [
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, g, ctx) => db.dossierSoins.count({ where: { planCouvertureId: g.id, organisationId: org(ctx) } })),
      dep('reclamations', 'réclamation', 'réclamations', (db, g, ctx) => db.reclamation.count({ where: { garantieId: g.id, organisationId: org(ctx) } })),
    ],
    regles: {
      supprimer: (g) => (g.produit?.statut !== 'BROUILLON' ? "La garantie d'un produit publié ou archivé ne se supprime pas : créez une nouvelle version du produit." : null),
      modifier: (g) => (g.produit?.statut !== 'BROUILLON' ? "La garantie d'un produit publié ou archivé ne se modifie pas : créez une nouvelle version du produit." : null),
    },
  },

  police: {
    designation: 'la police',
    pronom: 'la',
    table: 'polices',
    roles: GESTION_POLICE,
    charger: (db, id, ctx) => db.police.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (p) => p.numeroPolice ?? String(p.id).slice(0, 8),
    dependances: [
      dep('adherents', 'adhérent', 'adhérents', (db, p, ctx) => db.adherent.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('avenants', 'avenant', 'avenants', (db, p) => db.avenant.count({ where: { policeId: p.id } }), ['supprimer', 'modifier']),
      dep('cotisations', 'cotisation', 'cotisations', (db, p) => db.cotisation.count({ where: { policeId: p.id } }), ['supprimer', 'modifier']),
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, p, ctx) => db.dossierSoins.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('reclamations', 'réclamation', 'réclamations', (db, p, ctx) => db.reclamation.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, p, ctx) => db.codeConsultation.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('tarifications', 'tarification individuelle', 'tarifications individuelles', (db, p) => db.tarificationIndividuelle.count({ where: { policeId: p.id } }), ['supprimer', 'modifier']),
    ],
    regles: {
      supprimer: (p) => (p.statut !== 'DEVIS' ? 'Seule une police au stade du devis peut être supprimée ; une police en cours se résilie.' : null),
      modifier: (p) => (p.statut !== 'DEVIS' ? 'Seule une police au stade du devis se modifie librement ; ensuite, passez par un avenant.' : null),
    },
  },

  avenant: {
    designation: "l'avenant",
    pronom: 'le',
    table: 'avenants',
    roles: GESTION_POLICE,
    charger: (db, id, ctx) => db.avenant.findFirst({ where: { id, deletedAt: null, police: { organisationId: org(ctx) } } }),
    nom: (a) => `${a.type} (${String(a.id).slice(0, 8)})`,
    dependances: [],
    regles: {
      supprimer: (a) => (a.statut !== 'BROUILLON' ? 'Un avenant appliqué ou annulé est conservé ; seul un brouillon peut être supprimé.' : null),
      archiver: (a) => (a.statut !== 'BROUILLON' ? 'Seul un avenant en brouillon peut être annulé.' : null),
      modifier: (a) => (a.statut !== 'BROUILLON' ? 'Un avenant appliqué ou annulé ne se modifie pas.' : null),
    },
  },

  grilleTarifaire: {
    designation: 'la grille tarifaire',
    pronom: 'la',
    table: 'grilles_tarifaires',
    roles: ['ASSUREUR_INFORMATIQUE'],
    charger: (db, id, ctx) => db.grilleTarifaire.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (g) => `${g.trancheAgeMin}–${g.trancheAgeMax} ans`,
    // aucune trace des cotisations calculées avec une grille (écart n° 9 de l'audit)
    dependances: [],
    regles: { supprimer: () => null, modifier: () => null },
  },

  adherent: {
    designation: "l'adhérent",
    pronom: 'le',
    table: 'adherents',
    roles: GESTION_MEMBRE,
    roleSociete: ROLE_SOCIETE_MEMBRES,
    charger: (db, id, ctx) =>
      db.adherent.findFirst({
        where: { id, organisationId: org(ctx), deletedAt: null, ...(ctx.estSociete ? { souscripteurId: ctx.societeId ?? '' } : {}) },
      }),
    nom: (a) => `${a.prenom} ${a.nom}`,
    dependances: [
      dep('beneficiaires', 'bénéficiaire', 'bénéficiaires', (db, a) => db.beneficiaire.count({ where: { adherentId: a.id, deletedAt: null } })),
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, a, ctx) => db.dossierSoins.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('reclamations', 'réclamation', 'réclamations', (db, a, ctx) => db.reclamation.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('factures', 'facture', 'factures', (db, a, ctx) => db.factureDossier.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('cotisations', 'cotisation', 'cotisations', (db, a) => db.cotisation.count({ where: { adherentId: a.id } })),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, a, ctx) => db.codeConsultation.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('codesOrdonnance', "code d'ordonnance", "codes d'ordonnance", (db, a, ctx) => db.codeOrdonnance.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('comptes', 'compte utilisateur', 'comptes utilisateurs', (db, a, ctx) => db.profil.count({ where: { adherentId: a.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, a, ctx) => db.invitation.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('dossiersOuverts', 'dossier de soins ouvert', 'dossiers de soins ouverts', (db, a, ctx) => db.dossierSoins.count({ where: { adherentId: a.id, organisationId: org(ctx), statut: 'OUVERT' } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (a) => (a.statut === 'RADIE' ? dejaArchive("L'adhérent") : null),
      desarchiver: (a) => (a.statut !== 'RADIE' ? "L'adhérent n'est pas radié." : null),
      modifier: (a) => (a.statut === 'RADIE' ? "L'adhérent est radié : réactivez-le d'abord." : null),
    },
  },

  beneficiaire: {
    designation: 'le bénéficiaire',
    pronom: 'le',
    table: 'beneficiaires',
    roles: GESTION_MEMBRE,
    roleSociete: ROLE_SOCIETE_MEMBRES,
    charger: (db, id, ctx) =>
      db.beneficiaire.findFirst({
        where: {
          id,
          deletedAt: null,
          adherent: { organisationId: org(ctx), ...(ctx.estSociete ? { souscripteurId: ctx.societeId ?? '' } : {}) },
        },
      }),
    nom: (b) => `${b.prenom} ${b.nom}`,
    dependances: [
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, b, ctx) => db.dossierSoins.count({ where: { beneficiaireId: b.id, organisationId: org(ctx) } })),
      dep('reclamations', 'réclamation', 'réclamations', (db, b, ctx) => db.reclamation.count({ where: { beneficiaireId: b.id, organisationId: org(ctx) } })),
      dep('factures', 'facture', 'factures', (db, b, ctx) => db.factureDossier.count({ where: { beneficiaireId: b.id, organisationId: org(ctx) } })),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, b, ctx) => db.codeConsultation.count({ where: { beneficiaireId: b.id, organisationId: org(ctx) } })),
      dep('codesOrdonnance', "code d'ordonnance", "codes d'ordonnance", (db, b, ctx) => db.codeOrdonnance.count({ where: { beneficiaireId: b.id, organisationId: org(ctx) } })),
      dep('dossiersOuverts', 'dossier de soins ouvert', 'dossiers de soins ouverts', (db, b, ctx) => db.dossierSoins.count({ where: { beneficiaireId: b.id, organisationId: org(ctx), statut: 'OUVERT' } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (b) => (b.statut === 'RADIE' ? dejaArchive('Le bénéficiaire') : null),
      desarchiver: (b) => (b.statut !== 'RADIE' ? "Le bénéficiaire n'est pas radié." : null),
      modifier: (b) => (b.statut === 'RADIE' ? "Le bénéficiaire est radié : réactivez-le d'abord." : null),
    },
  },

  evenement: {
    designation: "l'événement",
    pronom: 'le',
    table: 'evenements',
    roles: ['ASSUREUR_INFORMATIQUE'],
    charger: (db, id, ctx) => db.evenement.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (e) => e.titre,
    dependances: [],
    regles: {
      supprimer: () => null,
      archiver: (e) => (!e.actif ? "L'événement est déjà masqué." : null),
      desarchiver: (e) => (e.actif ? "L'événement est déjà affiché." : null),
      modifier: () => null,
    },
  },

  compteFinancier: {
    designation: 'le compte financier',
    pronom: 'le',
    table: 'comptes_financiers',
    roles: GESTION_COMPTES,
    charger: (db, id, ctx) => db.compteFinancier.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (c) => c.nom,
    dependances: [
      dep('mouvements', 'mouvement financier', 'mouvements financiers', (db, c, ctx) => db.mouvementFinancier.count({ where: { organisationId: org(ctx), OR: [{ compteSourceId: c.id }, { compteDestinationId: c.id }] } })),
      dep('facturesEtablissement', 'facture mensuelle (établissement) programmée', 'factures mensuelles (établissements) programmées', (db, c, ctx) => db.factureMensuelleEtablissement.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
      dep('facturesPharmacie', 'facture mensuelle (pharmacie) programmée', 'factures mensuelles (pharmacies) programmées', (db, c, ctx) => db.factureMensuellePharmacie.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
      dep('paiementsGroupes', 'paiement groupé', 'paiements groupés', (db, c, ctx) => db.paiementGroupe.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
    ],
    regles: { supprimer: () => null, modifier: () => null },
  },
};

/** Libellés des entités du registre (messages, tests). */
export const ENTITES = Object.keys(REGISTRE);

/** Donne une fonction du registre avec son type (tests). */
export type Registre = typeof REGISTRE;
export type { Db };
