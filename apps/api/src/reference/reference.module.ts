import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DependancesModule } from '../dependances/dependances.module';
import { CatalogueActivationService } from './catalogue-activation.service';
import { CategoriesActeService } from './categories-acte.service';
import { LettresClesService } from './lettres-cles.service';
import { NomenclatureDocumentService } from './nomenclature-document';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

/**
 * Module `reference/` — un domaine métier strict (v18 §4) : référentiels
 * médicaux (actes + médicaments) et gouvernance d'homologation PROPOSE →
 * HOMOLOGUE → SUSPENDU/RETIRE (v8 §10, PROMPT 16), et référentiel unique des
 * catégories d'acte (`CategoriesActeService`, prisma/sql/067) utilisé par les
 * modules plan, preauthorization, claims et superadmin.
 */
@Module({
  imports: [IdentityModule, DependancesModule],
  controllers: [ReferenceController],
  providers: [ReferenceService, CatalogueActivationService, CategoriesActeService, LettresClesService, NomenclatureDocumentService],
  exports: [ReferenceService, CatalogueActivationService, CategoriesActeService, LettresClesService],
})
export class ReferenceModule {}
