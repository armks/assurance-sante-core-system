import { redirect } from 'next/navigation';

/**
 * `CENTRE_MEDICAL_ADMINISTRATIF` a des droits transverses (accueil, soins,
 * facturation) — il atterrit sur l'accueil et navigue via la barre latérale
 * commune.
 */
export default function AdministratifIndex() {
  redirect('/dashboard-centre-medical/accueil');
}
