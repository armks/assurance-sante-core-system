/**
 * Format d'une image d'après ses octets (jamais d'après l'extension ou le
 * `mimetype` déclaré par le client). Seuls PNG et JPEG sont reconnus : ce sont
 * les deux formats que pdf-lib sait embarquer (photo et logo sur la carte de
 * membre). Tout le reste (WEBP, SVG, fichier corrompu…) renvoie `null`.
 */
export function formatImagePdf(octets: Buffer): 'png' | 'jpg' | null {
  const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (octets.length >= 8 && octets.subarray(0, 8).equals(SIGNATURE_PNG)) {
    return 'png';
  }
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) {
    return 'jpg';
  }
  return null;
}
