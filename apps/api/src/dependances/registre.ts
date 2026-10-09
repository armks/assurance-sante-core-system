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
// Comptes financiers (lot 5) : modifier le libellé, archiver, désarchiver, supprimer — comptable et informatique
// (créer et mouvementer l'argent restent réservés au comptable, payment/).
const GESTION_COMPTES = ['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'] as const;
// Annulation des cotisations (lot 5) : comptable et informatique.
const GESTION_COTISATIONS = ['ASSUREUR_COMPTABLE', 'ASSUREUR_INFORMATIQUE'] as const;
const STATUTS_POLICE_FINAUX = ['RENOUVELEE', 'RESILIEE', 'NON_RENOUVELEE'];
const ROLE_SOCIETE_MEMBRES = 'SOCIETE_ADMINISTRATION';
// Suppression définitive des entités de configuration (lot 2) : service informatique,
// et direction pour les produits et leurs garanties.
const SUPPRESSION_INFORMATIQUE = { rolesSuppression: ['ASSUREUR_INFORMATIQUE'], libelleRolesSuppression: 'au service informatique' } as const;
// Sociétés clientes (lot 3) : suppression ET archivage réservés à la direction et à l'informatique.
const GESTION_ARCHIVAGE_SOUSCRIPTEUR = {
  rolesSuppression: ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'],
  libelleRolesSuppression: 'au service informatique et à la direction',
  rolesArchivage: ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'],
  libelleRolesArchivage: 'au service informatique et à la direction',
} as const;
// Archivage des partenaires du réseau (lot 3) : service informatique.
const ARCHIVAGE_INFORMATIQUE = { rolesArchivage: ['ASSUREUR_INFORMATIQUE'], libelleRolesArchivage: 'au service informatique' } as const;
const SUPPRESSION_PRODUIT = { rolesSuppression: ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_DIRECTION'], libelleRolesSuppression: 'au service informatique et à la direction' } as const;

// Comptes (lot 4) : rang des niveaux d'accès et rôles « administrateur de l'organisation ».
const RANG_NIVEAU: Record<string, number> = { LECTURE_SEULE: 1, MODIFICATION: 2, ADMIN: 3 };
/** Réclamation « en cours » : soumise, en adjudication ou en revue manuelle (ni payée, ni rejetée). */
const STATUTS_RECLAMATION_EN_COURS = ['SOUMISE', 'EN_ADJUDICATION', 'AUTO_ADJUDIQUE', 'REVUE_MANUELLE'];
const ROLES_ADMINISTRATEUR = ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_INFORMATIQUE_ADJOINT'];
/** Le compte est-il d'un niveau SUPÉRIEUR à l'appelant (niveau d'accès, ou rôle parent de l'appelant) ? */
const auDessusDeLAppelant = (p: any, ctx: ContexteDependances): boolean =>
  (RANG_NIVEAU[p._niveau] ?? 0) > (RANG_NIVEAU[ctx.niveauAcces] ?? 0) ||
  (!!p.role && ctx.roleChain.slice(1).includes(p.role));
const MESSAGE_NIVEAU_SUPERIEUR = "ce compte est d'un niveau supérieur au vôtre.";

/** « 12 500,00 F » */
const francs = (v: unknown) => `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} F`;

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
    ...GESTION_ARCHIVAGE_SOUSCRIPTEUR,
    charger: (db, id, ctx) => db.souscripteur.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (s) => s.nom,
    dependances: [
      dep('adherents', 'adhérent', 'adhérents', (db, s, ctx) => db.adherent.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('polices', 'police', 'polices', (db, s, ctx) => db.police.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('cotisations', 'cotisation', 'cotisations', (db, s, ctx) => db.cotisation.count({ where: { societeId: s.id, police: { organisationId: org(ctx) } } })),
      dep('grilles', 'grille tarifaire', 'grilles tarifaires', (db, s, ctx) => db.grilleTarifaire.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('imports', "import d'adhérents", "imports d'adhérents", (db, s, ctx) => db.importAdherents.count({ where: { souscripteurId: s.id, organisationId: org(ctx) } })),
      dep('questionnaires', 'questionnaire médical', 'questionnaires médicaux', (db, s) => db.questionnaireMedical.count({ where: { souscripteurId: s.id } })),
      dep('membresComite', 'membre du comité de gestion', 'membres du comité de gestion', (db, s) => db.membreComiteGestion.count({ where: { souscripteurId: s.id, deletedAt: null } })),
      dep('plansPaiement', 'plan de paiement', 'plans de paiement', (db, s) => db.planPaiementCollectivite.count({ where: { souscripteurId: s.id } })),
      // liens LOGIQUES (sans clé étrangère) relevés par l'audit
      dep('utilisateurs', 'compte utilisateur', 'comptes utilisateurs', (db, s, ctx) => db.profil.count({ where: { societeId: s.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, s, ctx) => db.invitation.count({ where: { societeId: s.id, organisationId: org(ctx) } })),
      // bloquent aussi l'ARCHIVAGE : contrats et sommes en cours
      dep('policesEnCours', 'police active ou suspendue', 'polices actives ou suspendues', (db, s, ctx) => db.police.count({ where: { souscripteurId: s.id, organisationId: org(ctx), deletedAt: null, statut: { in: ['ACTIVE', 'SUSPENDUE'] } } }), ['archiver']),
      dep('adherentsActifs', 'adhérent actif', 'adhérents actifs', (db, s, ctx) => db.adherent.count({ where: { souscripteurId: s.id, organisationId: org(ctx), deletedAt: null, statut: 'ACTIF' } }), ['archiver']),
      dep('cotisationsImpayees', 'cotisation à payer', 'cotisations à payer', (db, s, ctx) => db.cotisation.count({ where: { societeId: s.id, deletedAt: null, statut: { in: ['A_PAYER', 'EN_RETARD'] }, police: { organisationId: org(ctx) } } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      archiver: (s) => (s.statut === 'ARCHIVE' ? dejaArchive('La société cliente') : null),
      desarchiver: (s) => (s.statut !== 'ARCHIVE' ? "La société cliente n'est pas archivée." : null),
      modifier: (s) => (s.statut === 'ARCHIVE' ? 'La société cliente est archivée : désarchivez-la d’abord.' : null),
    },
  },

  utilisateur: {
    designation: 'le compte utilisateur',
    pronom: 'le',
    table: 'profils',
    roles: GESTION_UTILISATEURS,
    // archiver = RÉVOQUER (le compte n'est jamais supprimé), désarchiver = RÉACTIVER,
    // modifier = CHANGER LE RÔLE
    nomsAction: { archiver: 'Révocation', desarchiver: 'Réactivation', modifier: 'Changement de rôle' },
    charger: async (db, id, ctx) => {
      const p: any = await db.profil.findFirst({
        where: { id, organisationId: org(ctx), deletedAt: null },
        include: { sousRole: true },
      });
      if (!p) return null;
      let niveau: string = p.sousRole?.niveauAcces ?? 'LECTURE_SEULE';
      if (p.sousRole?.roleParentCode) {
        const parent: any = await db.sousRole.findUnique({ where: { code: p.sousRole.roleParentCode } });
        if (parent && (RANG_NIVEAU[parent.niveauAcces] ?? 0) > (RANG_NIVEAU[niveau] ?? 0)) niveau = parent.niveauAcces;
      }
      return { ...p, _niveau: niveau };
    },
    nom: (p) => `${p.role ?? 'sans rôle'} (${String(p.id).slice(0, 8)})`,
    dependances: [
      dep('lignesAudit', "ligne d'historique (audit)", "lignes d'historique (audit)", (db, p, ctx) => db.auditLog.count({ where: { userId: p.id, organisationId: org(ctx) } })),
      dep('consultations', 'consultation', 'consultations', (db, p, ctx) => db.consultationDossier.count({ where: { medecinId: p.id, dossier: { organisationId: org(ctx) } } })),
      dep('actesPrescrits', 'acte prescrit', 'actes prescrits', (db, p, ctx) => db.acteDossier.count({ where: { medecinPrescripteurId: p.id, dossier: { organisationId: org(ctx) } } })),
      dep('ordonnances', 'ordonnance', 'ordonnances', (db, p, ctx) => db.ordonnance.count({ where: { medecinId: p.id, organisationId: org(ctx) } })),
      dep('dispensations', 'dispensation', 'dispensations', (db, p, ctx) => db.dispensationPharmacie.count({ where: { caissiereId: p.id, pharmacie: { organisationId: org(ctx) } } })),
      dep('notes', 'note de dossier', 'notes de dossier', (db, p, ctx) => db.noteDossier.count({ where: { auteurId: p.id, organisationId: org(ctx) } })),
      dep('invitationsEnvoyees', 'invitation envoyée', 'invitations envoyées', (db, p, ctx) => db.invitation.count({ where: { invitePar: p.id, organisationId: org(ctx) } })),
      dep('mouvements', 'mouvement financier', 'mouvements financiers', (db, p, ctx) => db.mouvementFinancier.count({ where: { effectueParId: p.id, organisationId: org(ctx) } })),
      dep('avenants', 'avenant', 'avenants', (db, p, ctx) => db.avenant.count({ where: { creePar: p.id, police: { organisationId: org(ctx) } } })),
      // garde-fou : jamais sans administrateur — compte les AUTRES administrateurs actifs ; ce
      // compte, s'il est administrateur, ne peut être révoqué / supprimé / changé de rôle quand il
      // n'en existe aucun autre
      {
        cle: 'dernierAdministrateur',
        singulier: 'dernier administrateur actif',
        pluriel: 'derniers administrateurs actifs',
        bloque: ['supprimer', 'archiver', 'modifier'],
        bloquantSiNul: true,
        concerne: (p) => ROLES_ADMINISTRATEUR.includes(p.role),
        motif: "ce compte est le dernier administrateur actif de l'organisation : nommez-en un autre d'abord",
        compter: (db, p, ctx) =>
          db.profil.count({
            where: {
              organisationId: org(ctx),
              id: { not: p.id },
              role: { in: ROLES_ADMINISTRATEUR },
              deletedAt: null,
              statut: 'ACTIF',
              desactiveLe: null,
            },
          }),
      },
    ],
    regles: {
      supprimer: (p, ctx) => (p.id === ctx.userId ? 'Vous ne pouvez pas supprimer votre propre compte.' : auDessusDeLAppelant(p, ctx) ? MESSAGE_NIVEAU_SUPERIEUR : null),
      archiver: (p, ctx) =>
        p.id === ctx.userId
          ? 'Vous ne pouvez pas révoquer votre propre compte.'
          : p.statut === 'REVOQUE'
            ? 'ce compte est déjà révoqué.'
            : auDessusDeLAppelant(p, ctx)
              ? MESSAGE_NIVEAU_SUPERIEUR
              : null,
      desarchiver: (p, ctx) =>
        p.statut !== 'REVOQUE' && !p.desactiveLe
          ? "ce compte n'est ni révoqué ni désactivé."
          : auDessusDeLAppelant(p, ctx)
            ? MESSAGE_NIVEAU_SUPERIEUR
            : null,
      modifier: (p, ctx) =>
        p.id === ctx.userId
          ? 'Vous ne pouvez pas changer votre propre rôle.'
          : p.statut === 'REVOQUE'
            ? 'ce compte est révoqué : réactivez-le d’abord.'
            : auDessusDeLAppelant(p, ctx)
              ? MESSAGE_NIVEAU_SUPERIEUR
              : null,
    },
  },

  invitation: {
    designation: "l'invitation",
    pronom: 'la',
    table: 'invitations',
    roles: GESTION_UTILISATEURS,
    // désarchiver = RENVOYER une nouvelle invitation (depuis REVOQUEE ou EXPIREE) ; rien n'est supprimé
    nomsAction: { desarchiver: 'Renvoi' },
    charger: (db, id, ctx) => db.invitation.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (i) => i.email,
    dependances: [],
    regles: {
      supprimer: () => "Une invitation n'est jamais supprimée : elle reste dans l'historique des accès. Révoquez-la si elle est encore en attente.",
      desarchiver: (i) =>
        i.statut === 'REVOQUEE' || i.statut === 'EXPIREE' || (i.statut === 'EN_ATTENTE' && i.expireLe && new Date(i.expireLe).getTime() < Date.now())
          ? i.remplaceePar
            ? 'cette invitation a déjà été remplacée par une nouvelle.'
            : null
          : "seule une invitation révoquée ou expirée peut être renvoyée.",
    },
  },

  etablissement: {
    designation: "l'établissement de santé",
    pronom: 'le',
    table: 'etablissements_sante',
    roles: GESTION_RESEAU,
    ...ARCHIVAGE_INFORMATIQUE,
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
      dep('facturesMensuellesNonPayees', 'facture mensuelle non payée', 'factures mensuelles non payées', (db, e, ctx) => db.factureMensuelleEtablissement.count({ where: { etablissementId: e.id, organisationId: org(ctx), statut: { not: 'PAYEE' } } }), ['archiver']),
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
    ...ARCHIVAGE_INFORMATIQUE,
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
      dep('dispensationsEnCours', 'dispensation non payée', 'dispensations non payées', (db, p) => db.dispensationPharmacie.count({ where: { pharmacieId: p.id, statut: { notIn: ['PAYEE', 'ANNULEE'] } } }), ['archiver']),
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
    ...SUPPRESSION_INFORMATIQUE,
    conseils: {
      supprimer: "Fermez-le plutôt (date de fin) : l'historique est conservé.",
      modifier: "Utilisez « Changer à partir du… » : l'ancien tarif est fermé et le nouveau prend le relais.",
    },
    dependances: [
      // liens TRACÉS au moment du calcul (prisma/sql/074) : actes calculés avec ce tarif,
      // lignes de dispensation d'une pharmacie
      dep('actesCalcules', 'acte calculé avec ce tarif', 'actes calculés avec ce tarif', (db, t, ctx) =>
        db.acteDossier.count({ where: { tarifConventionneId: t.id, dossier: { organisationId: org(ctx) } } }),
        ['supprimer', 'modifier']),
      dep('lignesDispensation', 'ligne de dispensation calculée avec ce tarif', 'lignes de dispensation calculées avec ce tarif', (db, t, ctx) =>
        db.ligneDispensation.count({ where: { tarifPharmacieId: t.id, dispensation: { pharmacie: { organisationId: org(ctx) } } } }),
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
      // Tarif de PHARMACIE : le comptoir ne l'utilise plus (le prix est saisi par le caissier à partir du
      // prix national unique, migration 078) — il n'est donc jamais « utilisé » et se gère librement.
      supprimer: () => null,
      modifier: () => null,
      // archiver = FERMER le tarif (date de fin) ; désarchiver = le rouvrir
      archiver: (t) => (t.dateFin ? 'Le tarif est déjà fermé (date de fin renseignée).' : null),
      desarchiver: (t) => (!t.dateFin ? "Le tarif n'est pas fermé." : null),
    },
  },

  referentielActe: {
    designation: "l'acte du référentiel",
    pronom: 'le',
    table: 'referentiel_actes',
    roles: GESTION_REFERENTIEL_ACTES,
    ...SUPPRESSION_INFORMATIQUE,
    charger: (db, id, ctx) => db.referentielActe.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (a) => `${a.code} — ${a.libelle}`,
    dependances: [
      dep('tarifs', 'tarif conventionné', 'tarifs conventionnés', (db, a, ctx) => db.tarifConventionne.count({ where: { referentielActeId: a.id, organisationId: org(ctx), deletedAt: null } })),
      // liens LOGIQUES par code d'acte
      // lien FORT (prisma/sql/080) : `referentiel_acte_id` ; le code en texte libre reste compté pour l'historique
      dep('actes', 'acte de dossier', 'actes de dossier', (db, a, ctx) => db.acteDossier.count({ where: { dossier: { organisationId: org(ctx) }, OR: [{ referentielActeId: a.id }, { codeActe: a.code }] } })),
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
    ...SUPPRESSION_INFORMATIQUE,
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

  // Lettres-clés (lot barème 1) : référentiel paramétrable du superadmin ; archiver = DÉSACTIVER.
  lettreCle: {
    designation: 'la lettre-clé',
    pronom: 'la',
    table: 'lettres_cles',
    roles: SUPERADMIN,
    nomsAction: { archiver: 'Désactivation', desarchiver: 'Réactivation' },
    charger: (db, id) => db.lettreCle.findFirst({ where: { id } }),
    nom: (l) => `${l.code} — ${l.libelle}`,
    conseils: { supprimer: 'Désactivez-la plutôt : elle n’est plus proposée à la cotation, les actes déjà cotés sont conservés.' },
    dependances: [
      dep('actesNationaux', 'acte du catalogue national coté', 'actes du catalogue national cotés', (db, l) => db.referentielNationalActe.count({ where: { lettreCleCode: l.code, deletedAt: null } })),
      dep('actesOrganisations', 'acte d’organisation coté', 'actes d’organisations cotés', (db, l) => db.referentielActe.count({ where: { lettreCleCode: l.code, deletedAt: null } })),
    ],
    regles: {
      supprimer: () => null,
      archiver: (l) => (!l.actif ? 'La lettre-clé est déjà désactivée.' : null),
      desarchiver: (l) => (l.actif ? "La lettre-clé n'est pas désactivée." : null),
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
    ...SUPPRESSION_PRODUIT,
    charger: (db, id, ctx) => db.produit.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (p) => `${p.nom} v${p.version}`,
    dependances: [
      dep('polices', 'police', 'polices', (db, p, ctx) => db.police.count({ where: { produitId: p.id, organisationId: org(ctx) } })),
      // les garanties d'un brouillon partent AVEC lui (informatif, ne bloque rien)…
      dep('garanties', 'garantie', 'garanties', (db, p) => db.garantie.count({ where: { produitId: p.id, deletedAt: null } }), []),
      // … sauf si l'une d'elles est déjà utilisée (dossier de soins ou réclamation)
      dep('garantiesUtilisees', 'garantie utilisée (dossier de soins ou réclamation)', 'garanties utilisées (dossiers de soins ou réclamations)', (db, p) =>
        db.garantie.count({ where: { produitId: p.id, deletedAt: null, OR: [{ dossiersSoins: { some: {} } }, { reclamations: { some: {} } }] } })),
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
    ...SUPPRESSION_PRODUIT,
    charger: (db, id, ctx) =>
      db.garantie.findFirst({
        where: { id, deletedAt: null, produit: { organisationId: org(ctx) } },
        include: { produit: { select: { nom: true, statut: true } } },
      }),
    nom: (g) => `${g.produit?.nom ?? ''} — ${g.categorieActe}`,
    dependances: [
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, g, ctx) => db.dossierSoins.count({ where: { planCouvertureId: g.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('reclamations', 'réclamation', 'réclamations', (db, g, ctx) => db.reclamation.count({ where: { garantieId: g.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
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
      dep('avenants', 'avenant', 'avenants', (db, p) => db.avenant.count({ where: { policeId: p.id, deletedAt: null } }), ['supprimer', 'modifier']),
      dep('cotisations', 'cotisation', 'cotisations', (db, p) => db.cotisation.count({ where: { policeId: p.id, deletedAt: null } }), ['supprimer', 'modifier']),
      dep('dossiers', 'dossier de soins', 'dossiers de soins', (db, p, ctx) => db.dossierSoins.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('reclamations', 'réclamation', 'réclamations', (db, p, ctx) => db.reclamation.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, p, ctx) => db.codeConsultation.count({ where: { policeId: p.id, organisationId: org(ctx) } }), ['supprimer', 'modifier']),
      dep('tarifications', 'tarification individuelle', 'tarifications individuelles', (db, p) => db.tarificationIndividuelle.count({ where: { policeId: p.id } }), ['supprimer', 'modifier']),
    ],
    regles: {
      supprimer: (p) => (p.statut !== 'DEVIS' ? 'Seule une police au stade du devis peut être supprimée ; une police en cours se résilie.' : null),
      modifier: (p) => (p.statut !== 'DEVIS' ? 'Seule une police au stade du devis se modifie librement ; ensuite, passez par un avenant.' : null),
      // Statuts finaux (renouvelée, résiliée, non renouvelée) = archive DÉFINITIVE (STATUTS_POLICE_FINAUX) :
      // aucune route d'archivage ni de désarchivage ; on repart d'un devis (« Dupliquer en devis »).
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
    // archiver = ANNULER (motif obligatoire, jamais de suppression) ; pas de désarchivage
    nomsAction: { archiver: 'Annulation' },
    regles: {
      supprimer: (a) =>
        a.statut === 'BROUILLON'
          ? null
          : 'Un avenant appliqué ou annulé est conservé (historique) ; seul un brouillon peut être supprimé. Un avenant appliqué s’annule.',
      archiver: (a) =>
        a.statut === 'APPLIQUE'
          ? null
          : a.statut === 'ANNULE'
            ? 'cet avenant est déjà annulé.'
            : 'un avenant en brouillon se supprime, il ne s’annule pas ; seul un avenant appliqué s’annule.',
      modifier: (a) => (a.statut !== 'BROUILLON' ? 'Un avenant appliqué ou annulé ne se modifie pas.' : null),
    },
  },

  grilleTarifaire: {
    designation: 'la grille tarifaire',
    pronom: 'la',
    table: 'grilles_tarifaires',
    roles: ['ASSUREUR_INFORMATIQUE'],
    ...SUPPRESSION_INFORMATIQUE,
    charger: (db, id, ctx) => db.grilleTarifaire.findFirst({ where: { id, organisationId: org(ctx), deletedAt: null } }),
    nom: (g) => `${g.trancheAgeMin}–${g.trancheAgeMax} ans`,
    // liens TRACÉS au moment du calcul (prisma/sql/074) ; la modification reste permise :
    // chaque cotisation garde le montant calculé à sa date
    dependances: [
      dep('cotisations', 'cotisation calculée avec cette grille', 'cotisations calculées avec cette grille', (db, g, ctx) =>
        db.cotisation.count({ where: { grilleTarifaireId: g.id, police: { organisationId: org(ctx) } } })),
      dep('tarifications', 'tarification individuelle calculée avec cette grille', 'tarifications individuelles calculées avec cette grille', (db, g, ctx) =>
        db.tarificationIndividuelle.count({ where: { grilleTarifaireId: g.id, police: { organisationId: org(ctx) } } })),
    ],
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
      dep('cotisations', 'cotisation', 'cotisations', (db, a, ctx) => db.cotisation.count({ where: { adherentId: a.id, police: { organisationId: org(ctx) } } })),
      dep('codesConsultation', 'code de consultation', 'codes de consultation', (db, a, ctx) => db.codeConsultation.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('codesOrdonnance', "code d'ordonnance", "codes d'ordonnance", (db, a, ctx) => db.codeOrdonnance.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('comptes', 'compte utilisateur', 'comptes utilisateurs', (db, a, ctx) => db.profil.count({ where: { adherentId: a.id, organisationId: org(ctx), deletedAt: null } })),
      dep('invitations', 'invitation', 'invitations', (db, a, ctx) => db.invitation.count({ where: { adherentId: a.id, organisationId: org(ctx) } })),
      dep('dossiersOuverts', 'dossier de soins ouvert', 'dossiers de soins ouverts', (db, a, ctx) => db.dossierSoins.count({ where: { adherentId: a.id, organisationId: org(ctx), statut: 'OUVERT' } }), ['archiver']),
      dep('reclamationsEnCours', 'réclamation en cours', 'réclamations en cours', (db, a, ctx) => db.reclamation.count({ where: { adherentId: a.id, organisationId: org(ctx), statut: { in: STATUTS_RECLAMATION_EN_COURS } } }), ['archiver']),
      dep('cotisationsDues', 'cotisation due', 'cotisations dues', (db, a, ctx) => db.cotisation.count({ where: { adherentId: a.id, deletedAt: null, statut: { in: ['A_PAYER', 'EN_RETARD'] }, police: { organisationId: org(ctx) } } }), ['archiver']),
      // l'archivage d'un adhérent entraîne ses bénéficiaires : leurs activités en cours bloquent aussi
      dep('dossiersOuvertsBeneficiaires', "dossier de soins ouvert d'un bénéficiaire", "dossiers de soins ouverts de bénéficiaires", (db, a, ctx) => db.dossierSoins.count({ where: { organisationId: org(ctx), statut: 'OUVERT', beneficiaire: { adherentId: a.id, deletedAt: null } } }), ['archiver']),
      dep('reclamationsEnCoursBeneficiaires', "réclamation en cours d'un bénéficiaire", "réclamations en cours de bénéficiaires", (db, a, ctx) => db.reclamation.count({ where: { organisationId: org(ctx), statut: { in: STATUTS_RECLAMATION_EN_COURS }, beneficiaire: { adherentId: a.id, deletedAt: null } } }), ['archiver']),
    ],
    regles: {
      supprimer: () => null,
      // la société PROPOSE la sortie (mécanisme sortants existant) ; l'assureur l'effectue
      archiver: (a, ctx) =>
        a.statut === 'RADIE'
          ? dejaArchive("L'adhérent")
          : a.statut === 'PROPOSE_SORTANT' && ctx.estSociete
            ? "sa sortie est déjà proposée : elle attend la validation de l'assureur."
            : null,
      desarchiver: (a, ctx) =>
        a.statut !== 'RADIE'
          ? "L'adhérent n'est pas radié."
          : ctx.estSociete
            ? "la réactivation d'un adhérent sorti est réservée à l'assureur."
            : null,
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
      dep('reclamationsEnCours', 'réclamation en cours', 'réclamations en cours', (db, b, ctx) => db.reclamation.count({ where: { beneficiaireId: b.id, organisationId: org(ctx), statut: { in: STATUTS_RECLAMATION_EN_COURS } } }), ['archiver']),
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
    ...SUPPRESSION_INFORMATIQUE,
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
    conseils: { supprimer: 'Archivez-le plutôt : son historique de mouvements est conservé.' },
    dependances: [
      dep('mouvements', 'mouvement financier', 'mouvements financiers', (db, c, ctx) => db.mouvementFinancier.count({ where: { organisationId: org(ctx), OR: [{ compteSourceId: c.id }, { compteDestinationId: c.id }] } })),
      // références (même payées) : bloquent la SUPPRESSION ; les paiements encore PROGRAMMÉS bloquent l'ARCHIVAGE
      dep('facturesEtablissement', 'facture mensuelle (établissement) liée', 'factures mensuelles (établissements) liées', (db, c, ctx) => db.factureMensuelleEtablissement.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
      dep('facturesPharmacie', 'facture mensuelle (pharmacie) liée', 'factures mensuelles (pharmacies) liées', (db, c, ctx) => db.factureMensuellePharmacie.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
      dep('paiementsGroupes', 'paiement groupé lié', 'paiements groupés liés', (db, c, ctx) => db.paiementGroupe.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx) } })),
      dep('programmeesEtablissement', 'paiement programmé (facture mensuelle établissement)', 'paiements programmés (factures mensuelles établissements)', (db, c, ctx) => db.factureMensuelleEtablissement.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx), statut: { not: 'PAYEE' } } }), ['archiver']),
      dep('programmeesPharmacie', 'paiement programmé (facture mensuelle pharmacie)', 'paiements programmés (factures mensuelles pharmacies)', (db, c, ctx) => db.factureMensuellePharmacie.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx), statut: { not: 'PAYEE' } } }), ['archiver']),
      dep('groupesProgrammes', 'paiement groupé programmé', 'paiements groupés programmés', (db, c, ctx) => db.paiementGroupe.count({ where: { paiementProgrammeCompteId: c.id, organisationId: org(ctx), statut: { not: 'PAYE' } } }), ['archiver']),
    ],
    regles: {
      // jamais de suppression d'un compte qui détient de l'argent (le solde ne disparaît pas en silence)
      supprimer: (c) => (Number(c.soldeActuel) !== 0 ? `le solde n'est pas nul (${francs(c.soldeActuel)}) : transférez ou dépensez-le d'abord.` : null),
      // le solde ne se modifie JAMAIS directement : archiver exige un solde nul
      archiver: (c) =>
        c.statut === 'ARCHIVE'
          ? dejaArchive('Le compte')
          : Number(c.soldeActuel) !== 0
            ? `le solde n'est pas nul (${francs(c.soldeActuel)}) : transférez ou dépensez-le d'abord.`
            : null,
      desarchiver: (c) => (c.statut !== 'ARCHIVE' ? "Le compte n'est pas archivé." : null),
      modifier: (c) => (c.statut === 'ARCHIVE' ? 'le compte est archivé : désarchivez-le d’abord.' : null),
    },
  },

  // Cotisation (lot 5) : archiver = ANNULER (A_PAYER sans paiement, motif obligatoire) ; jamais supprimée.
  cotisation: {
    designation: 'la cotisation',
    pronom: 'la',
    table: 'cotisations',
    roles: GESTION_COTISATIONS,
    nomsAction: { archiver: 'Annulation' },
    charger: (db, id, ctx) => db.cotisation.findFirst({ where: { id, deletedAt: null, police: { organisationId: org(ctx) } } }),
    nom: (c) => `${String(c.periode instanceof Date ? c.periode.toISOString() : c.periode).slice(0, 7)} — ${francs(c.montantDu)}`,
    dependances: [],
    regles: {
      supprimer: (c) =>
        c.statut === 'PAYEE' || Number(c.montantPaye) > 0
          ? `une cotisation payée (${francs(c.montantPaye)} encaissés) n'est jamais supprimée : elle fait partie de l'historique comptable.`
          : "une cotisation n'est jamais supprimée : annulez-la (motif obligatoire), elle reste dans l'historique.",
      archiver: (c) =>
        c.statut === 'ANNULEE'
          ? 'cette cotisation est déjà annulée.'
          : Number(c.montantPaye) > 0
            ? `un paiement de ${francs(c.montantPaye)} a déjà été enregistré : une cotisation payée, même en partie, ne s'annule pas.`
            : c.statut !== 'A_PAYER'
              ? `seule une cotisation à payer sans paiement s'annule (statut actuel : ${c.statut}).`
              : null,
    },
  },

  // Propositions d'import (lot 5) : un BROUILLON de propositions se modifie et se supprime (logique) ;
  // soumis ou validé, il est conservé.
  propositionImport: {
    designation: 'la liste de propositions',
    pronom: 'la',
    table: 'imports_adherents',
    roles: ['ASSUREUR_INFORMATIQUE', 'ASSUREUR_EXPLOITATION', 'SOCIETE_ADMINISTRATION', 'SOCIETE_ASSUREE'],
    charger: (db, id, ctx) =>
      db.importAdherents.findFirst({
        where: { id, organisationId: org(ctx), deletedAt: null, ...(ctx.estSociete ? { souscripteurId: ctx.societeId ?? '' } : {}) },
      }),
    nom: (i) => i.fichierNom ?? `Liste de ${i.nbLignesTotal} proposition(s)`,
    dependances: [],
    regles: {
      supprimer: (i) => (i.statut !== 'BROUILLON' ? `seule une liste en brouillon peut être supprimée ; une liste ${i.statut === 'VALIDE' ? 'validée' : 'soumise'} est conservée.` : null),
      modifier: (i) => (i.statut !== 'BROUILLON' ? `cette liste n'est plus modifiable (statut ${i.statut}).` : null),
    },
  },
};

/** Libellés des entités du registre (messages, tests). */
export const ENTITES = Object.keys(REGISTRE);

/** Donne une fonction du registre avec son type (tests). */
export type Registre = typeof REGISTRE;
export type { Db };
