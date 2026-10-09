package ci.assurance.adjudication.domain;

import ci.assurance.adjudication.domain.AdjudicationRepository.CotationActe;
import ci.assurance.adjudication.domain.AdjudicationRepository.LigneConvention;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Résolveur de tarif CENTRALISÉ (ADR-008, lot 3) : utilisé par la simulation (donc la facture) ET la
 * réclamation — une seule implémentation, donc les mêmes décisions pour les mêmes actes.
 *
 * <p>Toutes les lectures sont filtrées par ORGANISATION (le rôle {@code svc_adjudication} contourne la RLS) :
 * jamais le tarif, l'acte ou la convention d'une autre organisation, même à code d'acte identique.
 */
public class ResolveurTarif {

  public static final String AMBULATOIRE = "AMBULATOIRE";
  public static final String HOSPITALISATION = "HOSPITALISATION";
  /** Types de visite du dossier qui placent les actes en contexte HOSPITALISATION. */
  public static final Set<String> TYPES_VISITE_HOSPITALISATION = Set.of("HOSPITALISATION_MEDICALE");

  private final AdjudicationRepository repo;

  public ResolveurTarif(AdjudicationRepository repo) {
    this.repo = repo;
  }

  public static String contexteDe(String typeVisite) {
    return typeVisite != null && TYPES_VISITE_HOSPITALISATION.contains(typeVisite) ? HOSPITALISATION : AMBULATOIRE;
  }

  public TarifResolu resoudre(ContexteTarif d) {
    // pas d'établissement (pharmacie…) ou pas de date : aucun tarif conventionné à chercher
    if (d == null || d.organisationId() == null || d.etablissementId() == null || d.dateSoins() == null) {
      return TarifResolu.nonApplicable();
    }
    return avecQuantite(resoudreUnitaire(d), d);
  }

  /** Tarif unitaire × quantité ; un acte NON TARIFABLE cherche son tarif proposé par l'établissement. */
  private TarifResolu avecQuantite(TarifResolu t, ContexteTarif d) {
    final int q = Math.max(d.quantite(), 1);
    if (t.nonTarifable()) {
      return tarifPropose(t, d, q);
    }
    return t.pourQuantite(q);
  }

  private TarifResolu tarifPropose(TarifResolu nonTarifable, ContexteTarif d, int q) {
    if (d.acteDossierId() == null) {
      return nonTarifable;
    }
    final Optional<AdjudicationRepository.TarifProposeActe> p = repo.tarifProposePourActe(d.organisationId(), d.acteDossierId());
    if (p == null || p.isEmpty()) {
      return nonTarifable;
    }
    final AdjudicationRepository.TarifProposeActe tp = p.get();
    switch (tp.statut()) {
      case "PROPOSE":
        return TarifResolu.propose(tp.montantPropose(), q, nonTarifable.conventionId(), nonTarifable.politiqueDepassement(), true, tp.id());
      case "VALIDE":
        return TarifResolu.propose(tp.montantPropose(), q, nonTarifable.conventionId(), nonTarifable.politiqueDepassement(), false, tp.id());
      case "AJUSTE":
        return TarifResolu.propose(tp.montantDecide(), q, nonTarifable.conventionId(), nonTarifable.politiqueDepassement(), false, tp.id());
      default: // REFUSE : aucun tarif — l'établissement peut en proposer un autre
        return TarifResolu.nonTarifable(nonTarifable.conventionId(), nonTarifable.politiqueDepassement(),
            nonTarifable.message() + " Le tarif proposé par l'établissement a été refusé.");
    }
  }

  private TarifResolu resoudreUnitaire(ContexteTarif d) {
    final Optional<ConventionApplicable> trouvee =
        repo.conventionEnVigueur(d.organisationId(), d.etablissementId(), d.dateSoins());
    if (trouvee == null || trouvee.isEmpty()) {
      // mode de transition : établissement sans convention en vigueur à la date des soins
      return TarifResolu.aucuneConvention();
    }
    final ConventionApplicable conv = trouvee.get();
    final String contexte = contexteDe(d.typeVisite());

    final UUID acteId = acteDuReferentiel(d);
    if (acteId == null) {
      return sansTarif(conv,
          "L'acte n'est pas rattaché au référentiel de l'organisation (code d'acte absent ou inconnu) : "
              + "il ne peut pas être tarifé par la convention " + conv.numero() + ".");
    }

    final Optional<LigneConvention> ligne = repo.ligneConvention(conv.id(), acteId, d.dateSoins());
    final Optional<CotationActe> cotation = repo.cotationActe(d.organisationId(), acteId);

    // 1) forfait de l'acte dans la convention
    if (ligne != null && ligne.isPresent() && ligne.get().prixForfaitaire() != null) {
      return new TarifResolu(TarifResolu.Statut.TARIFABLE, TarifResolu.Regle.FORFAIT,
          TarifResolu.arrondi(ligne.get().prixForfaitaire()), null, null, null,
          conv.id(), ligne.get().id(), conv.politiqueDepassement(), null);
    }
    // 2) valeur de lettre-clé propre à l'acte : coefficient × valeur
    if (ligne != null && ligne.isPresent() && ligne.get().valeurLettreCle() != null) {
      if (cotation == null || cotation.isEmpty()) {
        return sansTarif(conv,
            "La convention " + conv.numero() + " donne une valeur de lettre-clé propre à l'acte, mais l'acte n'est pas coté "
                + "(lettre-clé et coefficient) dans le référentiel.");
      }
      return parLettre(conv, cotation.get(), ligne.get().valeurLettreCle(), TarifResolu.Regle.VALEUR_PROPRE);
    }
    // 3) coefficient × valeur de la lettre-clé de la convention, selon le contexte
    if (cotation != null && cotation.isPresent()) {
      final Optional<BigDecimal> valeur = repo.valeurLettreCle(conv.id(), cotation.get().lettreCle(), contexte);
      if (valeur != null && valeur.isPresent()) {
        return parLettre(conv, cotation.get(), valeur.get(), TarifResolu.Regle.VALEUR_LETTRE_CLE);
      }
      return sansTarif(conv,
          "Aucune valeur négociée pour la lettre-clé " + cotation.get().lettreCle() + " ("
              + contexte.toLowerCase() + ") dans la convention " + conv.numero() + " et aucun forfait pour cet acte.");
    }
    return sansTarif(conv,
        "L'acte n'est pas coté (lettre-clé et coefficient) et la convention " + conv.numero()
            + " n'a pas de forfait pour lui.");
  }

  /**
   * Une convention HISTORIQUE (issue de la migration des anciens tarifs) n'est pas un barème complet : un acte
   * qu'elle ne liste pas garde le comportement historique (prix affiché reconnu), jamais « non tarifable ».
   */
  private TarifResolu sansTarif(ConventionApplicable conv, String message) {
    if (conv.historique()) {
      return TarifResolu.aucuneConvention();
    }
    return TarifResolu.nonTarifable(conv.id(), conv.politiqueDepassement(), message);
  }

  private TarifResolu parLettre(ConventionApplicable conv, CotationActe cot, BigDecimal valeur, TarifResolu.Regle regle) {
    final BigDecimal reconnu = TarifResolu.arrondi(cot.coefficient().multiply(valeur));
    return new TarifResolu(TarifResolu.Statut.TARIFABLE, regle, reconnu, cot.lettreCle(), cot.coefficient(), valeur,
        conv.id(), null, conv.politiqueDepassement(), null);
  }

  private UUID acteDuReferentiel(ContexteTarif d) {
    if (d.referentielActeId() != null) {
      return d.referentielActeId();
    }
    if (d.codeActe() == null || d.codeActe().isBlank()) {
      return null;
    }
    final Optional<UUID> id = repo.referentielActeId(d.organisationId(), d.codeActe());
    return id == null ? null : id.orElse(null);
  }
}
