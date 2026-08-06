# Back-office Maison Solstice — guide d'installation

Ce guide explique les **3 réglages** à faire une seule fois pour rendre le
back-office (demandes de devis + réponse par e-mail) pleinement fonctionnel.
Tout le code est déjà en place ; il ne reste qu'à connecter une base de
données, une boîte Gmail, et à choisir un mot de passe administrateur.

Comptez **~15 minutes**. Aucune ligne de code à écrire.

---

## Comment ça marche (en une phrase)

1. Un client remplit le formulaire de devis sur `/contact` (avec sa sélection
   du panier). → La demande est **enregistrée** et vous recevez une
   **notification par e-mail**.
2. Vous ouvrez `/admin`, vous voyez la liste des demandes, vous cliquez sur
   l'une d'elles : toutes les infos sont là, le devis est **pré-rempli**.
3. Vous ajustez les prix, vous cliquez **« Envoyer le devis »** : le client
   reçoit un **e-mail avec le devis en PDF** directement à son adresse.

Rien de tout cela ne fonctionne tant que les 3 réglages ci-dessous ne sont pas
faits — le site reste en ligne normalement, mais l'envoi du formulaire
affichera « service non activé ».

---

## Étape 1 — La base de données (Supabase)

Les demandes sont stockées dans une base **Supabase** (Postgres, offre gratuite
largement suffisante). Bonus : vous pourrez consulter et exporter toutes vos
demandes dans un vrai tableau.

**a) Créer le projet Supabase**
1. Allez sur **[supabase.com](https://supabase.com)** → **Sign in** (connexion
   avec GitHub ou Google) → **New project**.
2. Nom : `solstice` ; choisissez un mot de passe de base de données (gardez-le
   de côté, on n'en aura pas besoin ici) ; région **Europe (Frankfurt/Paris)**
   → **Create new project**. La création prend ~1 minute.

**b) Créer les tables** (le script est déjà prêt dans le dépôt)
1. Dans Supabase : menu de gauche → **SQL Editor** → **New query**.
2. Ouvrez le fichier **`supabase-schema.sql`** (à la racine du projet), copiez
   tout son contenu, collez-le dans l'éditeur, puis **Run**.
3. Vous devez voir « Success ». (Vous pourrez ensuite retrouver vos demandes
   dans **Table Editor → devis_requests**.)

**c) Récupérer les 2 clés d'accès**
1. Menu de gauche → **Project Settings** (roue crantée) → **API**.
2. Notez deux valeurs (elles serviront à l'Étape 3) :
   - **Project URL** → ira dans `SUPABASE_URL`
   - **Project API keys → `service_role`** (cliquez « Reveal ») → ira dans
     `SUPABASE_SERVICE_ROLE_KEY`

> ⚠️ La clé **`service_role`** est secrète : elle ne doit **jamais** apparaître
> côté site public ni sur GitHub. On la met uniquement dans les variables
> d'environnement Vercel (Étape 3), où elle reste côté serveur. C'est déjà le
> cas dans ce projet — aucune clé n'est écrite dans le code.

---

## Étape 2 — L'envoi des e-mails (boîte du domaine)

Les factures partent de la boîte **`contact@maison-solstice.fr`**, hébergée
chez OVH (offre Zimbra incluse avec le nom de domaine).

1. Espace client OVH → **Web Cloud** → **Zimbra** → onglet **Compte email** →
   bouton **+ Configurer**.
2. Créer l'adresse `contact@maison-solstice.fr` et choisir un mot de passe
   solide. Le noter : il servira à l'Étape 3.
3. Vérifier dans l'onglet **Domaine** que `maison-solstice.fr` est bien
   « configuré » — c'est ce qui pose automatiquement les enregistrements MX,
   SPF et DKIM chez OVH, indispensables pour que les factures n'arrivent pas
   en indésirable.
4. Se connecter une fois sur **<https://webmail.mail.ovh.net/>** pour valider
   que la boîte reçoit bien : envoyer un message de test depuis une autre
   adresse.

Réglages SMTP à retenir pour l'Étape 3 :

| Réglage | Valeur |
|---|---|
| Serveur | `ssl0.ovh.net` |
| Port | `587` (STARTTLS) — `465` fonctionne aussi, en SSL |
| Identifiant | l'adresse e-mail **complète** |
| Mot de passe | celui choisi à l'étape 2 |

> Pour lire les messages sur téléphone ou dans un client mail : même serveur
> `ssl0.ovh.net`, en **IMAP port 993 (SSL/TLS)**.

> **Ancienne configuration Gmail.** Les variables `GMAIL_USER` /
> `GMAIL_APP_PASSWORD` restent acceptées en secours : tant que les variables
> `SMTP_*` ne sont pas renseignées, l'envoi continue de passer par Gmail.

---

## Étape 3 — Les variables d'environnement dans Vercel

Dans votre projet Vercel → **Settings** → **Environment Variables**, ajoutez
les variables ci-dessous (Environment : **Production**, et **Preview** si vous
le souhaitez). Celles de l'Étape 1 sont déjà là si vous avez utilisé
« Connect Project ».

| Variable | Obligatoire | Valeur | Rôle |
|---|---|---|---|
| `ADMIN_PASSWORD` | ✅ | un mot de passe long que vous choisissez | Protège l'accès à `/admin` |
| `SESSION_SECRET` | ✅ recommandé | une longue chaîne aléatoire | Sécurise les sessions admin |
| `SMTP_HOST` | ✅ | `ssl0.ovh.net` | Serveur d'envoi |
| `SMTP_PORT` | facultatif | `587` (défaut) ou `465` | Port d'envoi |
| `SMTP_USER` | ✅ | `contact@maison-solstice.fr` | Expéditeur des factures |
| `SMTP_PASS` | ✅ | le mot de passe de la boîte (Étape 2) | Autorise l'envoi |
| `OWNER_EMAIL` | facultatif | l'adresse où recevoir les notifications | Par défaut = `SMTP_USER` |
| `SUPABASE_URL` | ✅ | la *Project URL* (Étape 1c) | Base de données |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | la clé *service_role* (Étape 1c) | Base de données |
| `PUBLIC_BASE_URL` | facultatif | ex. `https://solstice.fr` | Liens dans les e-mails de notif |

**Pour générer un `SESSION_SECRET`** : n'importe quelle longue suite de
caractères aléatoires convient. Par exemple, tapez dans un terminal
`openssl rand -hex 32`, ou utilisez un générateur de mot de passe (32+
caractères).

---

## Étape 4 — Redéployer

Les variables d'environnement ne sont prises en compte qu'au **prochain
déploiement**. Sur Vercel : onglet **Deployments** → menu « … » du dernier
déploiement → **Redeploy**. (Ou poussez un nouveau commit.)

---

## Utiliser le back-office

1. Rendez-vous sur **`votre-site/admin`**.
2. Entrez le `ADMIN_PASSWORD` choisi à l'Étape 3.
3. Vous voyez la liste des demandes (filtres : Nouvelles / Lues / Répondues,
   et une recherche par nom, lieu ou référence).
4. Cliquez une demande → toutes les infos s'affichent, avec la **sélection du
   client** et un **devis pré-rempli**.
5. Renseignez les **prix unitaires** (le reste est déjà là), ajustez si besoin
   le message et l'acompte, puis **« Envoyer le devis (PDF + e-mail) »**.
   Le client reçoit le devis en PDF à son adresse ; vous en recevez une copie.

### Réglez d'abord les informations de l'entreprise

Dans le back-office, bouton **« Réglages »** en haut à droite : renseignez le
nom de l'entreprise, l'adresse, le SIRET, la mention de TVA, l'acompte par
défaut, la validité du devis et les conditions. Ces informations apparaissent
**sur chaque PDF**. Tant qu'elles ne sont pas remplies, le PDF affiche des
mentions `[À COMPLÉTER]`.

---

## Dépannage

- **Le formulaire dit « service non activé » / erreur 503** → `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` manquants ou le script SQL (Étape 1b) n'a pas été
  exécuté ; ou il faut redéployer (Étape 4).
- **La facture ne part pas / erreur d'envoi** → vérifiez `SMTP_USER` et
  `SMTP_PASS` (l'identifiant est l'adresse e-mail **complète**), et que le
  serveur est bien `ssl0.ovh.net` sur le port `587`.
- **Impossible de se connecter à `/admin`** → `ADMIN_PASSWORD` non défini ou
  déploiement non refait après l'ajout de la variable.
- **Je ne reçois pas les notifications** → vérifiez `OWNER_EMAIL` (ou, à
  défaut, que `SMTP_USER` est bien votre boîte) et le dossier Spam.

---

## Notes techniques (pour info)

- Les fonctions serveur sont dans `/api` (Vercel Serverless, Node 18+). Les
  fichiers `api/_lib/*` sont des utilitaires internes (non exposés).
- Dépendances : `@supabase/supabase-js`, `nodemailer`, `pdfkit` (déjà dans
  `package.json`, installées automatiquement par Vercel).
- Sécurité : accès admin par cookie de session signé (HMAC), en `HttpOnly` +
  `Secure` + `SameSite=Strict` ; anti-spam par honeypot sur le formulaire ;
  toutes les entrées sont nettoyées côté serveur.
- Aucune donnée bancaire n'est collectée : le site fonctionne « sur devis ».
