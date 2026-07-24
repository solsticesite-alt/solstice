# Back-office Solstice — guide d'installation

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

## Étape 1 — La base de données (stockage des demandes)

Les demandes sont stockées dans une petite base **Redis** (via Upstash, offre
gratuite largement suffisante). Le plus simple est de l'ajouter depuis Vercel :

1. Ouvrez votre projet sur **vercel.com** → onglet **Storage**.
2. Cliquez **Create Database** → choisissez **Upstash for Redis** (ou
   « KV »/« Redis » selon l'affichage) → **Continue**.
3. Donnez-lui un nom (ex. `solstice-devis`), région **Europe** (Frankfurt ou
   Paris), puis **Create**.
4. À l'écran de connexion, cliquez **Connect Project** et reliez-la à votre
   projet Solstice.

Vercel ajoute alors **automatiquement** les variables suivantes à votre
projet (vous n'avez rien à copier) :

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

> Le code accepte aussi les noms `UPSTASH_REDIS_REST_URL` /
> `UPSTASH_REDIS_REST_TOKEN` si vous créez la base directement sur
> [upstash.com](https://upstash.com) puis copiez ces deux valeurs dans les
> variables d'environnement Vercel (voir Étape 3).

---

## Étape 2 — L'envoi des e-mails (Gmail)

On utilise votre boîte **Gmail** pour envoyer les devis. Gmail exige un
**« mot de passe d'application »** (différent de votre mot de passe habituel).

1. Votre compte Google doit avoir la **validation en deux étapes** activée :
   [myaccount.google.com/security](https://myaccount.google.com/security) →
   « Validation en deux étapes » → activez-la si ce n'est pas déjà fait.
2. Allez sur **[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)**.
3. Nommez l'application (ex. `Solstice`) et cliquez **Créer**.
4. Google affiche un code de **16 lettres** (ex. `abcd efgh ijkl mnop`).
   **Copiez-le** (les espaces n'ont pas d'importance).

Vous aurez besoin de deux valeurs à l'Étape 3 :

- `GMAIL_USER` = votre adresse Gmail complète (ex. `solstice.amiens@gmail.com`)
- `GMAIL_APP_PASSWORD` = le code à 16 lettres

> **Astuce présentation :** les e-mails partiront de votre adresse Gmail. Le
> nom affiché (« Solstice ») se règle dans le back-office (Réglages →
> « Nom de l'entreprise »). Pour une adresse plus professionnelle du type
> `contact@solstice.fr`, il faudra un nom de domaine + une boîte pro (étape
> ultérieure, non nécessaire pour démarrer).

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
| `GMAIL_USER` | ✅ | votre adresse Gmail | Expéditeur des devis |
| `GMAIL_APP_PASSWORD` | ✅ | le code à 16 lettres (Étape 2) | Autorise l'envoi |
| `OWNER_EMAIL` | facultatif | l'adresse où recevoir les notifications | Par défaut = `GMAIL_USER` |
| `KV_REST_API_URL` | ✅ | (ajoutée par Vercel à l'Étape 1) | Base de données |
| `KV_REST_API_TOKEN` | ✅ | (ajoutée par Vercel à l'Étape 1) | Base de données |
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

- **Le formulaire dit « service non activé » / erreur 503** → la base de
  données (Étape 1) n'est pas connectée, ou il faut redéployer (Étape 4).
- **Le devis ne part pas / erreur d'envoi** → vérifiez `GMAIL_USER` et
  `GMAIL_APP_PASSWORD` (mot de passe **d'application**, pas le mot de passe
  Gmail habituel), et que la validation en deux étapes est active.
- **Impossible de se connecter à `/admin`** → `ADMIN_PASSWORD` non défini ou
  déploiement non refait après l'ajout de la variable.
- **Je ne reçois pas les notifications** → vérifiez `OWNER_EMAIL` (ou, à
  défaut, que `GMAIL_USER` est bien votre boîte) et le dossier Spam.

---

## Notes techniques (pour info)

- Les fonctions serveur sont dans `/api` (Vercel Serverless, Node 18+). Les
  fichiers `api/_lib/*` sont des utilitaires internes (non exposés).
- Dépendances : `@upstash/redis`, `nodemailer`, `pdfkit` (déjà dans
  `package.json`, installées automatiquement par Vercel).
- Sécurité : accès admin par cookie de session signé (HMAC), en `HttpOnly` +
  `Secure` + `SameSite=Strict` ; anti-spam par honeypot sur le formulaire ;
  toutes les entrées sont nettoyées côté serveur.
- Aucune donnée bancaire n'est collectée : le site fonctionne « sur devis ».
