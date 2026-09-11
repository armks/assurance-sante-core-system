export interface CodeConsultationGenere {
  id: string;
  code: string;
  statut: string;
  dateEmission: string;
  dateExpiration: string;
  etablissement: { id: string; nom: string };
  message: string;
}
