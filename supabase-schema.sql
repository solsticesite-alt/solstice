-- ============================================================================
-- Solstice — schéma de base de données pour les demandes de devis (Supabase)
--
-- À exécuter UNE SEULE FOIS dans Supabase :
--   Dashboard → SQL Editor → New query → coller ce script → Run.
-- ============================================================================

-- Numéros de demande incrémentaux (1, 2, 3, …) via une séquence Postgres.
create sequence if not exists sol_req_seq;

create or replace function next_devis_id()
  returns bigint
  language sql
  as $$ select nextval('sol_req_seq'); $$;

-- Table des demandes de devis.
-- Quelques champs sont exposés en colonnes (pour une vue tableau lisible dans
-- Supabase) et l'objet complet est conservé dans `payload` (jsonb).
create table if not exists devis_requests (
  id             bigint primary key,
  ref            text,
  created_at     timestamptz default now(),
  status         text default 'new',
  client_name    text,
  client_email   text,
  event_type     text,
  event_date     text,
  event_location text,
  payload        jsonb not null
);

create index if not exists devis_requests_created_idx on devis_requests (created_at desc);
create index if not exists devis_requests_status_idx  on devis_requests (status);

-- Réglages de l'entreprise (une seule ligne, id = 1).
create table if not exists devis_settings (
  id   int primary key,
  data jsonb not null
);

-- Tentatives de connexion au back-office.
-- Le mot de passe admin ouvre les commandes ET la boîte mail du domaine : les
-- essais ratés sont comptés, et au-delà de 5 l'adresse est mise en attente,
-- pour un temps qui double à chaque nouvelle erreur (jusqu'à 6 h).
-- L'adresse IP n'est jamais stockée en clair, seulement son empreinte (HMAC).
-- Si cette table n'existe pas, le comptage se fait en mémoire : le site
-- fonctionne, mais le compteur repart à zéro à chaque redémarrage.
create table if not exists admin_logins (
  ip_hash   text primary key,
  fails     int not null default 0,
  last_fail timestamptz not null default now()
);

create index if not exists admin_logins_last_fail_idx on admin_logins (last_fail);

-- Sécurité : on active la Row Level Security et on ne crée AUCUNE politique
-- publique. Le site accède à ces tables uniquement via la clé « service_role »
-- (côté serveur), qui contourne la RLS. Ainsi, même avec la clé publique
-- (anon), personne ne peut lire les demandes de vos clients.
alter table devis_requests enable row level security;
alter table devis_settings enable row level security;
alter table admin_logins   enable row level security;

-- ============================================================================
-- Fin. Vous pouvez ensuite consulter vos demandes dans
-- Table Editor → devis_requests.
-- ============================================================================
