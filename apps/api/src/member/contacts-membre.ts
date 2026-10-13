import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';

const REGEX_TELEPHONE = /^\+?[0-9]{8,15}$/;

/**
 * Contacts d'un adhérent (téléphone, e-mail) : formats contrôlés côté serveur. `exigerUn` : au moins un des deux est obligatoire
 * (création d'un adhérent) ; sinon seuls les champs fournis sont contrôlés (modification partielle). Retourne les valeurs
 * normalisées (`null` = champ vide).
 */
export function validerContactsMembre(
  telephone: string | undefined,
  email: string | undefined,
  exigerUn: boolean,
): { telephone: string | null; email: string | null } {
  const tel = String(telephone ?? '').replace(/[\s.-]/g, '');
  const mail = String(email ?? '').trim().toLowerCase();
  const erreurs: string[] = [];
  if (exigerUn && !tel && !mail) erreurs.push('Renseignez au moins un contact : numéro de téléphone ou e-mail (les deux sont recommandés).');
  if (tel && !REGEX_TELEPHONE.test(tel)) erreurs.push(`Numéro de téléphone invalide (${tel}).`);
  if (mail && !isEmail(mail)) erreurs.push(`E-mail invalide (${mail}).`);
  if (erreurs.length) throw new BadRequestException({ message: 'Contacts invalides.', erreurs });
  return { telephone: tel || null, email: mail || null };
}
