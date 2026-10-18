import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

const BUCKET = 'nomenclature';
const CHEMIN = 'ngambci-2019-12.pdf';

/**
 * Texte officiel de la Nomenclature générale des actes de médecine et de biologie de Côte d'Ivoire (NGAMBCI, décembre 2019,
 * Comité technique CMU) : PDF conservé dans le bucket privé « nomenclature » (prisma/sql/111), servi par l'API.
 */
@Injectable()
export class NomenclatureDocumentService {
  async lire(): Promise<{ buffer: Buffer; nomFichier: string }> {
    const url = process.env.SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) throw new ServiceUnavailableException('Stockage indisponible : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents.');
    const res = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${CHEMIN}`, { headers: { Authorization: `Bearer ${cle}`, apikey: cle } });
    if (res.status === 404 || res.status === 400) throw new NotFoundException('Le document de la nomenclature n’est pas encore chargé.');
    if (!res.ok) throw new ServiceUnavailableException(`Document indisponible (${res.status}).`);
    return { buffer: Buffer.from(await res.arrayBuffer()), nomFichier: 'NGAMBCI-decembre-2019.pdf' };
  }
}
