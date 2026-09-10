import { redirect } from 'next/navigation';

export default function AdministrationIndex() {
  redirect('/dashboard-societe/administration/adherents');
}
