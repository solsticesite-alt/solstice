# Maison Solstice — Étapes à faire

Mémo des actions à faire **une seule fois**. Le site est déjà en ligne sur
`https://maison-solstice.fr` : rien ici n'est bloquant pour le consulter.

Les points sont classés du plus structurant au plus secondaire.

---

## 1. Ouvrir le compte bancaire, puis Stripe ⬅️ *en attente*

Pour encaisser les paiements en ligne, il faut **les deux** — ce ne sont pas des
concurrents :

- **le compte bancaire** (Qonto ou autre) = là où l'argent arrive ;
- **Stripe** = ce qui affiche le formulaire de carte sur le site et débite le
  client, puis reverse sur le compte.

**Dans cet ordre, car Stripe réclame un IBAN dès l'inscription :**

1. **Compte bancaire.** Un compte dédié n'est légalement obligatoire qu'au-delà
   de **10 000 € de chiffre d'affaires deux années civiles consécutives** (loi
   PACTE), avec 12 mois pour s'y conformer. En dessous, un simple compte courant
   séparé suffit. Recommandé quand même dès le départ pour la comptabilité.
   Qonto ≈ 9 €/mois ; un second compte courant gratuit fait aussi l'affaire.
2. **Stripe.** Créer le compte sur [stripe.com](https://stripe.com), y renseigner
   l'IBAN. **Le SIRET est demandé** : la micro-entreprise doit être immatriculée.
   Tarif indicatif : ~1 % + 0,25 € par transaction en carte européenne, sans
   abonnement.
3. **Me transmettre les clés Stripe** (publique + secrète) : je les mets dans les
   variables Vercel et je branche le paiement sur le panier, en respectant le
   choix du client (acompte 50 % ou paiement intégral).

> L'architecture est prête : le site a déjà des fonctions serveur (`/api`) et
> l'étape 3 du panier attend le paiement.

---

## 2. Brancher l'envoi des e-mails sur la boîte du domaine ⬅️ *à faire*

La boîte `contact@maison-solstice.fr` existe, mais le site envoie encore les
factures depuis l'ancienne adresse Gmail. Pour basculer, ajouter quatre
variables dans Vercel → Settings → Environment Variables (Production), puis
redéployer :

| Variable | Valeur |
|---|---|
| `SMTP_HOST` | `ssl0.ovh.net` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `contact@maison-solstice.fr` |
| `SMTP_PASS` | le mot de passe de la boîte |

Tant qu'elles ne sont pas là, l'envoi continue par Gmail : rien ne casse.

À faire aussi : renseigner cette adresse dans le back-office → **Réglages**,
c'est elle qui sert d'**adresse de réponse** sur les factures.

> Pour lire les messages : l'onglet **Messages** du back-office (il utilise
> ces mêmes identifiants, rien de plus à configurer), le webmail sur
> <https://webmail.mail.ovh.net/>, ou en IMAP sur téléphone — serveur
> `ssl0.ovh.net`, port `993` en SSL/TLS.

---

## 3. Protection du domaine — *fait, avec une réserve*

**DMARC est en place** (vérifié le 6 août 2026) :
`v=DMARC1; p=none; rua=mailto:contact@maison-solstice.fr`, aux côtés de SPF
(`v=spf1 include:mx.ovh.com ~all`) et des MX OVH.

**DKIM n'est pas disponible** sur l'offre Zimbra du domaine. Ce n'est pas
bloquant : DMARC passe dès lors que **SPF *ou* DKIM** s'aligne, et SPF
s'aligne bien puisque les envois partent de `contact@maison-solstice.fr`
via les serveurs OVH.

> ⚠️ **Ne pas passer à `p=quarantine` ni `p=reject` tant qu'il n'y a pas de
> DKIM.** Sans lui, un message légitime *redirigé* par le destinataire (une
> ancienne adresse qui renvoie vers Gmail, par exemple) échoue à SPF à
> l'arrivée et n'a aucune autre preuve d'authenticité. `p=none` donne la
> visibilité sans ce risque.

Si l'occasion se présente : espace OVH → **Zimbra** → onglet **Domaine**, ou
un ticket au support pour demander l'activation de DKIM. Gratuit, côté
serveur, rien à modifier dans le site.

**Les rapports DMARC** arrivent désormais sur `contact@maison-solstice.fr` :
pièces jointes XML ou ZIP quotidiennes envoyées par Google, Microsoft et
consorts. C'est normal, ce n'est pas du spam.

---

## 4. Activer le back-office (factures par e-mail) — ~15 min

Suivre **[SETUP-BACKOFFICE.md](./SETUP-BACKOFFICE.md)** : base Supabase, envoi
Gmail, variables Vercel. Tant que ce n'est pas fait, le formulaire affiche
« service non activé ».

> À régler au passage : la variable Vercel `PUBLIC_BASE_URL` =
> `https://maison-solstice.fr` (liens dans les e-mails de notification).

> 🔁 **Si Supabase est déjà en place**, relance une fois le script
> `supabase-schema.sql` (SQL Editor → coller → Run). Il ajoute la table
> `admin_logins`, qui retient les tentatives de connexion ratées au
> back-office. Le script ne détruit rien et peut être rejoué autant de fois
> que nécessaire.

> 🔑 **Le mot de passe du back-office** (`ADMIN_PASSWORD` dans Vercel) ouvre
> désormais aussi ta boîte mail : prends-en un long et unique. Au-delà de
> 5 essais ratés, l'adresse qui insiste est mise en attente, pour un temps qui
> double à chaque nouvelle erreur (jusqu'à 6 h).

---

## 5. Compléter les informations légales

Obligatoire dès l'émission de factures, et à remplir dans deux endroits :

**a) Back-office → Réglages** (ces informations apparaissent **sur chaque
facture**) : dénomination, statut juridique, SIRET, adresse, mention de TVA.
Tant qu'elles manquent, le PDF affiche des `[À COMPLÉTER]`.

**b) Pages du site** :
- **Mentions légales** : nom / statut juridique, SIRET, adresse de l'éditeur.
- **Conditions de location** : les `[…]` restants — délais d'annulation,
  montant/durée de la caution, frais de livraison, moyens de paiement acceptés,
  mention TTC ou HT.
- **À propos** : prénom + histoire du projet.
- **Contact** : liens réels **Instagram** et **TikTok** (aujourd'hui `#`).

> ⚠️ La numérotation des factures doit rester **continue et sans trou** : ne pas
> supprimer une facture déjà émise.

---

## 6. Référencer le site sur Google (Search Console)

Le blocage `noindex` a été retiré : Google a le **droit** d'indexer le site.
Pour accélérer (sinon l'indexation naturelle prend plusieurs semaines) :

1. Aller sur **[search.google.com/search-console](https://search.google.com/search-console)**,
   se connecter avec un compte Google.
2. **Ajouter une propriété** → type **« Préfixe de l'URL »** → saisir exactement :
   `https://maison-solstice.fr`
3. **Validation** : méthode **« Balise HTML »**. Google affiche une balise
   `<meta name="google-site-verification" content="…">`.
   → **Me l'envoyer** : je l'ajoute au site, on redéploie, puis cliquer
   « Valider ». (Aucune manipulation technique de votre côté.)
4. Une fois validé : menu **Sitemaps** → taper `sitemap.xml` → **Envoyer**.
5. Ensuite, suivre les mots-clés dans « Résultats de recherche », et forcer
   l'indexation d'une page via « Inspection de l'URL ».

---

## 7. Envoyer le catalogue et les tarifs

Pour que le panier chiffre tout automatiquement, il me faut, par article :
**nom · prix · unité (jour ou week-end) · caution · catégorie**.

Et si possible :
- le **contenu réel des packs** (pack complet / les tables), pour que les
  collections se chiffrent au lieu d'afficher « au devis » ;
- la **grille de livraison** (ex. offert sous X km, puis Y €), pour un total
  complet sans surprise.

Les filtres du catalogue fonctionnent désormais. Ils lisent des étiquettes
posées sur chaque fiche : **catégorie, style, couleur, thème, saison, prix**
(plus « coup de cœur » ou « nouveauté »). Quand tu m'enverras le vrai
catalogue, indique simplement ces informations pour chaque pièce — je pose
les étiquettes et tout se filtre sans autre travail.

---

## Déjà fait

- **Nom de domaine** : `maison-solstice.fr` (OVHcloud) connecté à Vercel —
  enregistrement A sur la racine + CNAME `www`. Sitemap et robots.txt à jour.
- **Site public** : accessible sans mur de connexion, indexable par Google.
- **Adresse e-mail** `contact@maison-solstice.fr` : boîte Zimbra Starter
  active chez OVH (15 Go). L'adresse est en place sur tout le site.
