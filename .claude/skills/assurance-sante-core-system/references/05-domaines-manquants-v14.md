---
name: saas-assurance-sante-afrique
version: 14.0
description: >
  Extension v14 — comble les domaines réellement absents identifiés dans la liste de 30
  points de l'utilisateur : CRM, Service Client, API Gateway formalisé, Recherche plein
  texte, Administration SaaS (licences/santé système), comptabilité complète (grand livre),
  signature électronique, paiement carte bancaire, facturation/échéancier des cotisations.
  Tout reste en Next.js + Supabase — rien de ceci ne va dans le microservice Java (v12).
---

# Extension v14 — Domaines manquants pour un core system complet

## 1. CRM (absent) — à ne pas confondre avec les "réclamations" d'assurance

⚠️ **Attention terminologique** : le mot "réclamations" a déjà un sens précis dans ce
système — c'est le sinistre/la demande de remboursement (`reclamations`, v2 §4). Le CRM,
lui, gère les **réclamations au sens plainte/insatisfaction** (un adhérent mécontent d'un
délai de traitement, par exemple). Pour éviter toute confusion dans le code, on nomme cette
seconde notion `plaintes`, jamais `reclamations`.

```sql
create table contacts_crm (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  adherent_id uuid references adherents(id),
  societe_id uuid references souscripteurs(id),
  type_contact text check (type_contact in ('APPEL','EMAIL','CHAT','VISITE','WHATSAPP')),
  sujet text,
  notes text,
  cree_par uuid references profils(id),
  created_at timestamptz default now()
);

create table plaintes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts_crm(id),
  categorie text check (categorie in
    ('DELAI_TRAITEMENT','MONTANT_REMBOURSEMENT','QUALITE_SERVICE','ETABLISSEMENT','AUTRE')),
  description text,
  statut text check (statut in ('OUVERTE','EN_COURS','RESOLUE','ESCALADEE')) default 'OUVERTE',
  assignee_a uuid references profils(id),
  date_resolution timestamptz
);
```

## 2. Service Client (absent)

```sql
create table tickets_support (
  id uuid primary key default gen_random_uuid(),
  adherent_id uuid references adherents(id),
  canal text check (canal in ('CENTRE_APPEL','CHAT','EMAIL','WHATSAPP')),
  sujet text not null,
  priorite text check (priorite in ('BASSE','NORMALE','HAUTE','URGENTE')) default 'NORMALE',
  statut text check (statut in ('OUVERT','EN_COURS','RESOLU','FERME')) default 'OUVERT',
  assigne_a uuid references profils(id),
  created_at timestamptz default now()
);

create table faq_articles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  question text not null,
  reponse text not null,
  categorie text,
  publie boolean default true
);
```

Interface : `/dashboard-assureur/service-client` (file de tickets, priorisation) et un
widget FAQ accessible depuis le dashboard adhérent, avant d'ouvrir un ticket (réduit la
charge du centre d'appels).

## 3. API Gateway (mentionné en v3 §10 sans détail — formalisé ici)

Nécessaire dès que des tiers externes (SIRH d'une société cliente, futur partenaire) doivent
accéder à des données via API plutôt que par l'interface web.

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  souscripteur_id uuid references souscripteurs(id),  -- si clé limitée à une société
  nom text,
  cle_hash text not null,           -- jamais la clé en clair, uniquement son hash
  scopes text[],                     -- ex: ['adherents:read', 'mouvements:write']
  actif boolean default true,
  cree_par uuid references profils(id),
  derniere_utilisation timestamptz,
  expire_le timestamptz
);
```

Toutes les routes API externes (ex: synchronisation des mouvements de personnel d'une
société, v9 §10) passent par un point d'entrée unique qui : valide la clé API (jamais un JWT
utilisateur pour un appel machine-à-machine), vérifie les `scopes`, applique une limitation
de débit (rate limiting, ex. via Supabase Edge Function + compteur Redis ou table dédiée), et
journalise chaque appel via `log_audit()`.

## 4. Recherche plein texte (absent)

```sql
alter table adherents add column recherche_vecteur tsvector
  generated always as (to_tsvector('french', coalesce(nom,'') || ' ' || coalesce(prenom,'') || ' ' || coalesce(numero_adherent,''))) stored;
create index idx_recherche_adherents on adherents using gin(recherche_vecteur);
```

Même pattern à répliquer sur `etablissements_sante`, `pharmacies`, `reclamations` (par
référence). Postgres `tsvector`/`tsquery` suffit largement à ce stade — pas besoin d'un
moteur de recherche externe (Elasticsearch/Algolia) tant que le volume reste raisonnable.

## 5. Administration SaaS — licences et santé du système (absent)

```sql
create table licences_organisation (
  organisation_id uuid references organisations(id) primary key,
  plan text check (plan in ('STARTER','BUSINESS','ENTERPRISE')),
  limite_adherents int,
  limite_appels_api_mois int,
  date_debut date,
  date_fin date,
  statut text check (statut in ('ACTIVE','SUSPENDUE','EXPIREE'))
);
```

Page `/dashboard-superadmin/sante-systeme` : nombre d'organisations actives, adhérents par
organisation vs limite de licence, requêtes API du mois vs quota, statut des dernières
sauvegardes (lien avec le PCA défini en v3 §15) — un tableau de bord d'exploitation de la
plateforme elle-même, distinct des dashboards métier.

## 6. Comptabilité complète (v3 §7.3 ne couvrait que la réserve technique)

```sql
create table plan_comptable (
  code text primary key,
  libelle text,
  type text check (type in ('ACTIF','PASSIF','CHARGE','PRODUIT'))
);

create table ecritures_comptables (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  date_ecriture date not null,
  compte_debit text references plan_comptable(code),
  compte_credit text references plan_comptable(code),
  montant numeric not null,
  libelle text,
  reference_metier uuid,          -- reclamation_id, cotisation_id, paiement_id...
  created_at timestamptz default now()
);
```

Le grand livre et la balance sont des **vues** calculées à partir de `ecritures_comptables`
(sommes par compte/période), jamais des tables stockées séparément — pour éviter toute
divergence entre le grand livre affiché et les écritures sources.

## 7. Facturation, échéancier et pénalités des cotisations

```sql
alter table cotisations add column date_echeance date;
alter table cotisations add column penalite_appliquee numeric default 0;
alter table cotisations add column jours_retard int generated always as
  (case when statut = 'EN_RETARD' then greatest(0, current_date - date_echeance) else 0 end) stored;

create table baremes_penalite (
  produit_id uuid references produits(id),
  jours_retard_min int,
  taux_penalite_pourcent numeric
);
```

## 8. Signature électronique (absent — souscription réelle en dépend)

Intégration recommandée : un fournisseur de signature électronique conforme (ex. DocuSign,
ou une solution africaine locale si disponible dans votre marché) — ne pas développer un
mécanisme de signature maison, la valeur juridique d'une signature électronique dépend de la
conformité du prestataire, pas de la qualité du code.

```sql
alter table polices add column signature_id text;       -- référence chez le prestataire
alter table polices add column signature_statut text
  check (signature_statut in ('EN_ATTENTE','SIGNEE','REFUSEE'));
alter table polices add column document_signe_url text;
```

## 9. Paiement par carte bancaire (absent — seuls Mobile Money et virement existaient)

Intégration via un agrégateur de paiement présent en Côte d'Ivoire (ex. CinetPay, PayDunya,
ou équivalent) plutôt qu'une intégration directe avec les réseaux de cartes — plus rapide à
mettre en place et déjà conforme localement.

```sql
alter table paiements add column type_moyen text
  check (type_moyen in ('MOBILE_MONEY','VIREMENT','CARTE_BANCAIRE'));
```

## 10. Documents d'identité (KYC) — absent en tant que module explicite

```sql
create table documents_identite (
  id uuid primary key default gen_random_uuid(),
  adherent_id uuid references adherents(id),
  type_document text check (type_document in ('CNI','PASSEPORT','ACTE_NAISSANCE','AUTRE')),
  numero text,
  url_storage text,          -- Supabase Storage, bucket privé
  verifie boolean default false,
  verifie_par uuid references profils(id)
);
```

---

## Feuille de route de maturité — où placer ces ajouts

| Ajout | Palier |
|---|---|
| Documents d'identité (KYC), Recherche plein texte | 1 — MVP (utile dès le départ pour la conformité et l'usabilité) |
| Signature électronique, Facturation/échéancier/pénalités | 2 — Croissance |
| Paiement carte bancaire | 2 — Croissance (en complément du Mobile Money déjà en MVP) |
| CRM, Service Client, API Gateway | 2 — Croissance |
| Comptabilité complète (grand livre), Administration SaaS (licences/santé système) | 3 — Entreprise |

Ne bloquez pas le MVP pour ces ajouts — seuls les deux premiers (KYC, recherche) valent la
peine d'être inclus dès le Palier 1, le reste attend que le MVP soit validé.
