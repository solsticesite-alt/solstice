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
> `supabase-schema.sql` (SQL Editor → coller → Run). Il ajoute les tables
> `admin_logins` (tentatives de connexion ratées) et `admin_security`
> (double authentification, sessions). Le script ne détruit rien et peut être
> rejoué autant de fois que nécessaire.

> 🔑 **Le mot de passe du back-office** ouvre le fichier de tes clients et,
> par l'onglet Messages, ta boîte mail : prends-en un long et unique. Au-delà
> de 5 essais ratés, l'adresse qui insiste est mise en attente, pour un temps
> qui double à chaque nouvelle erreur (jusqu'à 6 h).

---

### 4 bis. Trois gestes qui verrouillent le back-office ⬅️ *à faire*

Le code est en place ; il ne reste que des gestes de ton côté. Dans cet ordre :

**a) Rejouer `supabase-schema.sql`** (voir ci-dessus). Sans la table
`admin_security`, le back-office refuse d'activer la double authentification
et te le dit franchement.

**b) Activer la double authentification.** ⏸️ *Reportée volontairement — à faire
à la passation.*

> ⚠️ **À faire par la personne qui utilisera réellement le back-office, sur SON
> téléphone.** Si elle est activée depuis un autre téléphone, cette personne ne
> pourra plus se connecter sans lui. C'est la seule raison pour laquelle ce
> point attend : le code est en place et fonctionne, il ne manque qu'un geste.
>
> **Au moment de la passation, dans cet ordre :**
> 1. changer le mot de passe du back-office (`npm run motdepasse`, puis
>    `ADMIN_PASSWORD_HASH` dans Vercel) — l'ancien ne doit plus ouvrir ;
> 2. la personne se connecte, va dans **Sécurité** → « Activer la double
>    authentification », ajoute la clé dans SON application (Google
>    Authenticator, 1Password, Authy…) par **saisie manuelle**, et entre le
>    code affiché ;
> 3. elle note les 8 codes de secours **sur papier**.
>
> Tant que ce n'est pas fait, un seul mot de passe garde le fichier des clients
> et la boîte mail. C'est le point qui coûte le plus au score de sécurité.

**La clé ne doit jamais quitter l'écran.** Ni capture d'écran partagée, ni
message, ni e-mail : c'est la graine dont tous les codes à six chiffres sont
dérivés, pour toujours. Si elle a été vue par quelqu'un d'autre, il suffit de
cliquer « Annuler » et de recommencer — une nouvelle clé est générée et
l'ancienne ne vaut plus rien.

> 📄 **Note les 8 codes de secours** qui apparaissent ensuite, et range-les
> **ailleurs que dans ton téléphone**. Sans eux, un téléphone perdu = un
> back-office perdu. Chacun ne sert qu'une fois et ils ne sont plus jamais
> affichés.

**c) Remplacer le mot de passe en clair par son empreinte.** Aujourd'hui
`ADMIN_PASSWORD` contient ton mot de passe lisible : une capture d'écran du
tableau de bord Vercel suffit à le donner. À la place :

```
npm run motdepasse
```

La commande demande le mot de passe sans l'afficher et produit une empreinte.
Dans Vercel → Settings → Environment Variables :

| | |
|---|---|
| Ajouter | `ADMIN_PASSWORD_HASH` = l'empreinte produite |
| Supprimer | `ADMIN_PASSWORD` |

Puis redéploie. **Toutes les sessions ouvertes se ferment d'elles-mêmes** —
c'est voulu, et c'est aussi ce qui manquait avant : changer le mot de passe ne
déconnectait personne.

> Le bouton **« Déconnecter partout »** (Sécurité) ferme toutes les autres
> sessions sans toucher au mot de passe — utile si tu as laissé le back-office
> ouvert quelque part.

---

## 5. Compléter les informations légales

Obligatoire dès l'émission de factures, et à remplir dans deux endroits :

**a) Back-office → Réglages** (ces informations apparaissent **sur chaque
facture**) : dénomination, statut juridique, SIRET, adresse, mention de TVA.
Tant qu'elles manquent, le PDF affiche des `[À COMPLÉTER]`.

**b) Pages du site** :
- **Mentions légales** : nom / statut juridique, SIRET, adresse de l'éditeur.
- **Confidentialité** : la même identité (responsable du traitement) — c'est la
  seule non-conformité RGPD qui reste, et elle attend la création de
  l'entreprise. Le nom de ton comptable, une fois choisi.
- **Conditions de location** : les `[…]` restants — délais d'annulation,
  montant/durée de la caution, frais de livraison, moyens de paiement acceptés,
  mention TTC ou HT.
- **À propos** : prénom + histoire du projet.
- **Contact** : liens réels **Instagram** et **TikTok** (aujourd'hui `#`).

> ⚠️ La numérotation des factures doit rester **continue et sans trou** : ne pas
> supprimer une facture déjà émise. Le bouton « Supprimer cette demande » du
> back-office t'avertit quand une facture a été émise — lis l'avertissement
> avant de confirmer.

**c) Deux réglages à vérifier chez tes hébergeurs** (données personnelles de
tes clients, donc RGPD) :
- **Vercel → Settings → Functions → Function Region** : choisis **Paris
  (cdg1)** ou Francfort. Sans réglage, tes fonctions tournent par défaut aux
  États-Unis, et les données de tes clients y transitent.
- **Supabase → Settings → General** : vérifie que la région du projet est bien
  en Europe. Si ce n'est pas le cas, il faut recréer le projet — mieux vaut le
  savoir avant d'avoir de vrais clients.

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

> 🔗 **Les formules se chiffrent désormais toutes seules** à partir du
> catalogue. Chaque pièce d'une formule pointe vers une fiche de `pieces.js` ;
> le prix, l'unité et la caution en sont tirés automatiquement, jusque dans le
> panier. Il n'y a plus de code à écrire pour ça — seulement des données.

**Les 12 pièces qui manquent au catalogue.** Ce sont exactement celles que les
formules réclament sans les trouver : elles s'affichent « à chiffrer » dans le
pop-up et dans le panier. Donne-moi leur prix et elles se chiffreront comme le
reste :

| Pièce | Ajustement |
|---|---|
| Mange-debout + housse | par tranche de 12 invités |
| Verres à cocktail (coupe + tumbler) | 2 par invité |
| Bar & desserte | par tranche de 20 invités |
| Seau à champagne | par tranche de 12 invités |
| Plateaux de service | par tranche de 12 invités |
| Serviettes cocktail | 2 par invité |
| Assiettes (service 2 pièces) | 1 par invité |
| Verres (eau + vin) | 2 par invité |
| Couverts (parure complète) | 1 par invité |
| Serviettes en tissu | 1 par invité |
| Marque-places | 1 par invité |
| Coin lounge (fauteuils & table basse) | 1, quel que soit le nombre |

> Les huit autres pièces des formules sont déjà reliées : chaises, tables,
> arche, guirlande, nappe, chemin de table, centre de table, photophores.

Et si possible :
- le **contenu réel des trois formules** (Cocktail / Table / Réception) pour
  chacune des six collections de couleur — quelles pièces, en quelle quantité ;
- les **vraies couleurs** des six collections : aujourd'hui ce sont des teintes
  d'attente (Terracotta, Vert olivier, Écru côté Été ; Bordeaux, Bleu nuit,
  Doré côté Hiver). Donne-moi tes nuances et je les remplace partout ;
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
