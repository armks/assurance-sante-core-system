import { IsIn } from 'class-validator';

/** Format d'impression d'un document (facture de soins, facture de médicaments). */
export class ImpressionQueryDto {
  @IsIn(['pdf', 'docx'])
  format!: 'pdf' | 'docx';
}

export const TYPES_MIME_IMPRESSION = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
