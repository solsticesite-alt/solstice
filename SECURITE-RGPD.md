# 🔒 Sécurité & RGPD — Solstice

Document de référence pour la sécurité du site et la conformité RGPD/CNIL/LCEN.
Il distingue **ce qui est fait**, **ce qui reste à compléter maintenant**, et **la feuille de route pour le futur site dynamique** (réservations, espace client).

_Dernière mise à jour de ce document : à la mise en place initiale._

---

## 1. État actuel & surface d'attaque

Le site est aujourd'hui une **vitrine statique** (un fichier `index.html`, sans base de données ni formulaire actif), hébergée sur Vercel. La surface d'attaque est donc **minimale** :

- Pas de backend, pas de base de données, pas d'authentification → pas d'injection SQL, pas de fuite de compte.
- Aucune donnée personnelle collectée pour l'instant (les boutons « Ajouter au panier », « Demande » sont visuels).
- HTTPS/TLS fourni automatiquement par Vercel.

La priorité actuelle est donc : **durcir la configuration**, **poser le cadre légal**, et **préparer proprement** l'arrivée des fonctions dynamiques.

---

## 2. ✅ Ce qui est mis en place maintenant

### Sécurité technique (`vercel.json`)
En-têtes HTTP de sécurité appliqués à tout le site :

| En-tête | Rôle |
|---|---|
| `Content-Security-Policy` | Bloque l'exécution de scripts/ressources non autorisés (anti-XSS, anti-injection) |
| `Strict-Transport-Security` (HSTS) | Force le HTTPS, empêche le downgrade |
| `X-Content-Type-Options: nosniff` | Empêche le navigateur de « deviner » les types de fichiers |
| `X-Frame-Options: DENY` + `frame-ancestors 'none'` | Anti-clickjacking (le site ne peut pas être mis en iframe) |
| `Referrer-Policy` | Limite les infos de provenance envoyées aux autres sites |
| `Permissions-Policy` | Désactive caméra, micro, géoloc, paiement, FLoC/Topics non utilisés |
| `Cross-Origin-Opener-Policy` | Isole la fenêtre des autres origines |

- `cleanUrls` activé → les pages légales sont accessibles sans `.html` (ex. `/confidentialite`).
- HTTPS + redirection automatique (`upgrade-insecure-requests`).

### Cadre légal (pages créées)
- **`/mentions-legales`** — obligatoire (LCEN art. 6) : éditeur, hébergeur, propriété intellectuelle.
- **`/confidentialite`** — politique RGPD complète : données, finalités, bases légales, durées, droits, CNIL.
- **`/cookies`** — politique cookies (état actuel : aucun traceur → pas de bandeau requis).
- **`/cgl`** — conditions générales de location (trame).
- Liens légaux ajoutés dans le **footer** de toutes les pages.

> ⚠️ Ces pages contiennent des champs `[À COMPLÉTER]` : voir la section 6.

### Accès au back-office
Un seul mot de passe (`ADMIN_PASSWORD`) garde les commandes des clients **et**
la boîte mail du domaine. Ce qui le protège aujourd'hui :

- **Comparaison en temps constant** : la durée de la vérification ne trahit pas
  le nombre de caractères justes.
- **Cookie de session signé** (HMAC-SHA256), `HttpOnly` + `Secure` +
  `SameSite=Strict`, valable 7 jours. Inaccessible au JavaScript de la page,
  jamais envoyé en clair, jamais joint à une requête venue d'un autre site.
- **Changer le mot de passe ferme les sessions ouvertes** (la clé de signature
  en dérive), sauf si `SESSION_SECRET` est défini séparément.
- **Aucune session possible sans secret configuré.** Un secret de repli était
  auparavant écrit en clair dans le dépôt : sur un déploiement où
  `ADMIN_PASSWORD` n'était pas encore renseigné, un cookie forgé avec cette
  valeur publique aurait ouvert le back-office. Corrigé.
- **Mise en attente progressive** : 5 essais tolérés, puis l'adresse attend
  1 min, 2 min, 4 min… jusqu'à 6 h, et le bon mot de passe lui-même n'y coupe
  pas. Sous le seuil, chaque réponse est déjà ralentie. Le compteur s'oublie
  après 6 h sans erreur, et une connexion réussie le remet à zéro.
- **L'adresse IP n'est jamais stockée en clair** : seule une empreinte HMAC
  sert de clé de comptage (table `admin_logins`).

> À faire quand le besoin s'en fera sentir : une 2FA, et un second compte pour
> séparer la lecture des commandes de l'accès à la boîte mail.

### Conservation et effacement des données

Les durées annoncées dans la politique de confidentialité ne sont plus
seulement promises : **le code les applique**.

| Situation | Durée | Ce qui se passe |
|---|---|---|
| Demande restée sans suite (aucune facture) | **3 ans** | effacée automatiquement |
| Demande facturée (pièce comptable) | **10 ans** | conservée, puis effacée |

Le balayage a lieu **au plus une fois par jour**, au moment où tu ouvres le
back-office, et il n'est jamais silencieux : un bandeau annonce le nombre de
demandes effacées. Trois garde-fous encadrent ce code, parce qu'une donnée
effacée à tort ne revient pas :

- une date illisible, absente ou située dans le futur **n'efface jamais rien** —
  dans le doute, on garde ;
- **200 suppressions au maximum** par passage, pour borner les dégâts d'une
  erreur ;
- c'est la date du **dernier événement** qui compte (une demande de 2020
  facturée en 2025 reste une pièce de 2025).

#### Un client demande l'effacement de ses données (art. 17)

1. **Back-office → onglet Commandes → la demande → « Supprimer cette
   demande ».** Il faut recopier la référence pour confirmer : il n'y a pas de
   corbeille.
2. **Supprime aussi les e-mails échangés** avec lui — onglet Messages, ou
   directement dans le webmail OVH. La suppression en base ne les touche pas,
   et la fenêtre de confirmation te le rappelle.
3. **Si une facture a été émise, refuse l'effacement de la facture** et
   explique-le au client : l'obligation comptable de 10 ans (art. L123-22 du
   Code de commerce) prime sur le droit à l'effacement. Tu peux en revanche
   effacer tout le reste. Le back-office t'avertit dans ce cas.
4. **Réponds sous un mois** (art. 12.3). Un simple e-mail confirmant ce qui a
   été effacé suffit.

---

## 3. 📋 Registre RGPD des traitements (à tenir à jour)

Le RGPD impose de documenter ses traitements. Voici la base, à compléter dès que les formulaires seront actifs :

| Traitement | Données | Finalité | Base légale | Conservation |
|---|---|---|---|---|
| Demande de réservation / devis | Identité, contact, dates, lieu, articles | Établir un devis | Mesures précontractuelles | 3 ans après dernier contact |
| Contrat de location | Coordonnées, adresse livraison, facturation | Exécuter la location | Contrat | Durée de la relation + 3 ans |
| Facturation | Identité, montants | Obligation comptable | Obligation légale | 10 ans |
| Espace client _(à venir)_ | E-mail, mot de passe chiffré, historique | Gérer le compte | Contrat | Jusqu'à suppression |
| Newsletter _(le cas échéant)_ | E-mail | Actualités | Consentement | Jusqu'au retrait |
| Mesure d'audience _(le cas échéant)_ | Données de navigation | Améliorer le site | Consentement | 13 mois max (cookies) |

**Principes appliqués :** minimisation (ne collecter que l'utile), limitation de conservation, sécurité, transparence.

---

## 4. 🤝 Sous-traitants (art. 28 RGPD)

Chaque prestataire qui traite des données pour ton compte doit être encadré par un contrat (DPA) et, si hors UE, par des garanties de transfert.

| Sous-traitant | Rôle | Hors UE ? | Action |
|---|---|---|---|
| **Vercel Inc.** | Hébergement du site + exécution des fonctions serverless | Société américaine. **La région d'exécution n'est pas fixée** → tes fonctions tournent probablement aux États-Unis | Régler la région sur **Paris (cdg1)** ou Francfort : Vercel → Settings → Functions → Function Region. Puis vérifier le DPA (clauses contractuelles types) |
| **Supabase Inc.** | Base de données : toutes les demandes clients | Société américaine, mais l'instance est dans la région choisie à la création du projet | **Vérifier la région du projet** (Settings → General). Si elle n'est pas en Europe, la migration impose de recréer le projet |
| **OVH SAS** | Nom de domaine + messagerie `contact@maison-solstice.fr` | Non (France) | Rien à faire, DPA OVH applicable de plein droit |
| [Comptable / facturation] | Administratif, dès la première facture | À déterminer | Signer un DPA au moment du choix |
| _Mesure d'audience_ | — | — | **Aucun outil installé.** Si tu en ajoutes un, privilégier une solution sans cookie et hébergée en UE (Plausible, Matomo) |

---

## 5. 🍪 Stratégie cookies & consentement

- **Aujourd'hui :** aucun traceur → **pas de bandeau** (la CNIL demande de ne pas solliciter un consentement inutile).
- **Dès l'ajout d'un traceur non essentiel** (analytics non exempté, intégrations Instagram/TikTok, pub) → **bandeau de consentement obligatoire** : « Accepter » et « Refuser » aussi simples l'un que l'autre, plus un « Paramétrer ». Rien ne se dépose avant l'accord.
- **Recommandation :** utiliser une mesure d'audience **sans cookie / exemptée** (Vercel Web Analytics, ou Matomo en mode exempté) → statistiques utiles **sans** bandeau.
- Pour les intégrations réseaux sociaux : préférer un **chargement au clic** (une image cliquable qui charge l'embed seulement après consentement).

---

## 6. ✍️ Ce dont j'ai besoin de toi (pour finaliser les pages légales)

Tous les `[À COMPLÉTER]` des pages viennent de ces infos :

1. **Statut juridique** : micro-entreprise / entreprise individuelle / société ? (ça change les mentions obligatoires et la TVA)
2. **Nom / dénomination** exact à afficher publiquement + **nom du responsable de publication**.
3. **Numéro SIRET** (dès que l'activité est immatriculée).
4. **Adresse** du siège (obligatoire dans les mentions légales).
5. **E-mail de contact** public (je te déconseille d'utiliser ton Gmail personnel — plutôt `contact@` ou `bonjour@` sur ton futur domaine).
6. **Téléphone** (facultatif mais recommandé).
7. **Régime de TVA** (micro = « TVA non applicable, art. 293 B du CGI »).
8. Pour les **CGL** : montant/pourcentage d'acompte, règles de caution, délais et pénalités d'annulation, paliers de livraison, éventuel médiateur de la consommation.

> Dès que tu me donnes ces infos, je remplis tout et je pousse — c'est automatique.

---

## 7. 🚀 Feuille de route sécurité — futur site dynamique

Quand on construira les vraies fonctions (réservations, panier, espace client), voici ce qu'on mettra en place **by design** :

### Formulaires (demande de réservation, contact)
- Validation stricte des entrées côté serveur (jamais faire confiance au client).
- Protection anti-spam **sans cookie** (honeypot, rate limiting) plutôt qu'un captcha intrusif.
- Case de **consentement** explicite + rappel de la finalité et lien vers la politique de confidentialité.
- Protection **CSRF** sur les formulaires authentifiés.

### Espace client (comptes)
- Mots de passe **hachés** (bcrypt / argon2), jamais en clair.
- Politique de mot de passe robuste + limitation des tentatives (anti-bruteforce).
- Sessions sécurisées (cookies `HttpOnly`, `Secure`, `SameSite`), déconnexion, expiration.
- 2FA optionnelle pour ton espace admin.

### Données & infrastructure
- Base de données **dans l'UE** si possible, accès chiffré, sauvegardes régulières et testées.
- **Secrets** (clés API, mots de passe) dans les variables d'environnement, **jamais** dans le code / Git.
- Journalisation des accès sensibles (sans stocker de données inutiles).
- `npm audit` / mises à jour des dépendances (Dependabot).
- Paiement (si un jour acompte en ligne) : **via un prestataire certifié PCI-DSS** (Stripe, etc.) — ne jamais stocker de numéro de carte.

### E-mails & domaine (quand tu auras le domaine)
- **SPF, DKIM, DMARC** configurés → délivrabilité + anti-usurpation.
- **DNSSEC** activé chez le registrar.
- E-mail pro (`contact@ton-domaine.fr`) plutôt que Gmail.

### Procédure violation de données
- En cas de fuite à risque : **notification à la CNIL sous 72 h** + information des personnes concernées si nécessaire.
- Tenir un registre des violations.

---

## 8. ✅ Checklist priorisée

**Fait maintenant**
- [x] En-têtes de sécurité (CSP, HSTS, anti-clickjacking, COOP, CORP…)
- [x] HTTPS forcé
- [x] Pages légales (structure + contenu RGPD)
- [x] Liens légaux dans le footer
- [x] `robots.txt`, favicon, page **404** personnalisée
- [x] `.well-known/security.txt` (RFC 9116) — _contact à compléter_
- [x] `.gitignore` (empêche de committer `.env` / secrets)
- [x] Métadonnées SEO / Open Graph
- [x] Aucun fichier de config/interne servi publiquement (build ne copie que le nécessaire)

**À faire dès que possible (tes infos)**
- [ ] Compléter les `[À COMPLÉTER]` (section 6)
- [ ] Créer un e-mail de contact pro
- [ ] Vérifier / archiver le DPA de Vercel

**Avant d'activer les formulaires**
- [ ] Case de consentement + finalité sur chaque formulaire
- [ ] Choisir un prestataire de formulaire/e-mail (UE de préférence) + DPA
- [ ] Mesure d'audience sans cookie (ou bandeau de consentement conforme)

**Avant le lancement du site dynamique**
- [ ] Sécurité des comptes (hash, sessions, anti-bruteforce)
- [ ] Validation serveur + anti-spam + CSRF
- [ ] Secrets en variables d'environnement
- [ ] SPF/DKIM/DMARC + DNSSEC sur le domaine
- [ ] Sauvegardes testées
- [ ] Registre des traitements finalisé

---

## 9. 🔎 Audit indépendant (multi-agents) — résultats

Un audit automatisé (5 angles : en-têtes/CSP · RGPD · exposition de données · infra · hygiène web, chaque trouvaille vérifiée de façon adverse) a confirmé 21 points. Traitement :

**✅ Corrigé**
- **Accessibilité** : contraste du gris `--stone` relevé de `#978B78` à `#6F6455` (corrige un échec WCAG 2.1 AA sur les textes d'info).
- **Avis** : témoignages marqués « exemples illustratifs » + intitulés neutralisés (évite une pratique commerciale trompeuse — les avis étant fictifs avant le 1er événement).
- **Hiérarchie des titres** corrigée sur l'accueil (h2 → h3 pour cartes et étapes).
- **RGPD** : base légale du formulaire de contact précisée (intérêt légitime, art. 6.1.f) ; droit de réclamation CNIL rendu inconditionnel ; ajout du moyen d'obtenir une copie des garanties de transfert hors UE.
- **CSP** : `font-src` nettoyé (`data:` inutile retiré).
- **`X-Robots-Tag: noindex`** ajouté — empêche l'indexation tant que le site est en pré-lancement (pages légales encore en `[À COMPLÉTER]`).
- Favicon + `theme-color` ajoutés aux pages légales et à la 404 ; doublon `<title>` retiré de l'accueil ; `robots.txt` nettoyé.

**⏳ En attente (dépend du domaine ou de tes infos)**
- **CSP `script-src 'unsafe-inline'`** → passer à un script externe / hash / nonce quand le JS sera stabilisé (ou au passage à Next.js).
- `canonical`, `sitemap.xml`, `og:image`/`og:url`, champ `Canonical` du `security.txt` : nécessitent le **domaine définitif**.
- Vérifier que la **boîte e-mail de contact** existe et aligner l'adresse partout.
- ⚠️ **Retirer `X-Robots-Tag: noindex` au lancement** — sinon Google n'indexera pas le site.
- **Dépôt GitHub** : s'il est public, envisager de le passer en privé (le doc interne y est lisible — sans aucun secret toutefois).
- **Vercel** : activer la « Deployment Protection » sur les préversions (réglage du dashboard, pas du code).

---

## 10. 🔒 Audit du back-office (août 2026)

Audit mené en attaquant réellement le back-office depuis un navigateur : injection
de code par le formulaire public, e-mail piégé dans la boîte, appels d'API sans
cookie, détournement d'en-têtes, inondation du formulaire.

**Ce qui a tenu**
- **Aucune injection de code (XSS) n'aboutit.** Une demande dont chaque champ —
  nom, e-mail, téléphone, lieu, message, libellé d'article — contient du code
  s'affiche partout comme du texte : liste, détail, composeur de facture.
- **Le lecteur d'e-mails neutralise tout** : scripts, iframes, formulaires,
  gestionnaires `onclick`/`onload`, liens `javascript:` retirés ; images
  distantes non chargées (aucun pixel espion ne signale que tu as ouvert le
  message) ; les liens légitimes, eux, sont conservés. Le message s'affiche dans
  un cadre isolé, sans autorisation d'exécuter du script.
- **Toutes les routes d'administration répondent 401 sans cookie valide** :
  commandes, détail, réglages, messagerie, envoi de facture.
- **Aucun secret dans le dépôt**, aucune dépendance vulnérable
  (`npm audit` : 0), `/admin` exclu de `robots.txt` et du sitemap.
- **Cookie de session** signé, `HttpOnly` + `Secure` + `SameSite=Strict` :
  inexploitable depuis un autre site.

**Trois défauts trouvés, tous corrigés**
1. **Détournement de l'en-tête `Host` _(le plus sérieux)_.** En envoyant une
   demande avec un en-tête `X-Forwarded-Host` falsifié, un attaquant faisait
   pointer le bouton « Ouvrir le back-office » de ton e-mail de notification
   vers **son** site. Un clic, un faux écran de connexion, et le mot de passe
   partait. Seuls les hôtes connus sont désormais acceptés ; à défaut, le lien
   retombe sur le domaine.
2. **Formulaire public sans limite.** 25 demandes passaient en 39 ms — autant de
   lignes en base et d'e-mails dans ta boîte. Plafond : **5 demandes par heure et
   par adresse**, comptées après validation du formulaire (une faute de frappe
   corrigée ne consomme rien).
3. **Fuite de configuration.** `/api/admin/me` indiquait à un inconnu quels
   services étaient branchés (base, SMTP, IMAP). Réservé aux sessions ouvertes.

Au passage : `GET /api/admin/logout` est refusé — une simple image posée sur un
autre site suffisait sinon à faire sauter ta session.

### Le nettoyeur d'e-mails passé au tamis

Le premier audit n'avait éprouvé le nettoyeur qu'avec **un** jeu de charges,
écrit par la même main que le nettoyeur — ce qui ne prouve à peu près rien. Il a
donc été soumis à **1 094 charges** (répertoire classique d'évasion de filtres +
mutations : casse, espaces exotiques, guillemets dépareillés, entités, octets
de contrôle), chaque sortie étant **rejouée dans un vrai navigateur, sans le bac
à sable** — de façon à mesurer cette couche seule et non le filet derrière elle.

**Trois défauts, tous corrigés :**

1. **Un nom d'attribut maquillé contournait le contrôle d'URL.** `href` suivi
   d'un octet invisible n'était pas reconnu comme une URL, échappait donc à la
   vérification de schéma — puis le nom était nettoyé à l'écriture et
   ressortait en `href` parfaitement vivant, avec son `javascript:`. Le nom est
   désormais normalisé **avant** tout contrôle, jamais après.
2. **Découpe des attributs à l'expression régulière.** Des guillemets mal
   appariés faisaient tomber la coupure au mauvais endroit : des débris
   ressortaient dans la page et le navigateur les relisait comme des attributs
   que le nettoyeur n'avait jamais examinés. Remplacée par un vrai analyseur,
   qui lit, filtre, puis réécrit sous une forme toujours bien formée.
3. **Le pistage à la lecture ne passait que partiellement.** Seuls `<img src>`
   et `background=` étaient mis de côté ; `//serveur/pixel.png`,
   `<input type=image>`, l'affiche d'une vidéo, `srcset`, `url()` en CSS et
   `style=` sans guillemets passaient. _Portée réelle limitée :_ l'iframe porte
   `default-src 'none'; img-src data:`, qui bloquait déjà ces requêtes — mais
   le compteur « images bloquées » mentait, et le bouton « afficher les
   images » en révélait plus que demandé.

Un courrier légitime (tableaux, `bgcolor`, styles, liens, images incorporées)
traverse intact — c'est vérifié par un test dédié.

**Limites connues, assumées pour l'instant**
- Le freinage compte **par adresse IP**. Un attaquant disposant de milliers
  d'adresses contourne la limite. C'est inhérent : la vraie défense reste un mot
  de passe long et unique.
- `script-src 'unsafe-inline'` reste nécessaire tant que le JS est écrit
  directement dans les pages (voir section 9).
- **Pas de déconnexion à distance** : si `SESSION_SECRET` est défini, changer le
  mot de passe ne ferme pas les sessions ouvertes (jusqu'à 7 jours). À ajouter
  si le besoin se présente.
- **Rien n'a été vérifié en production.** Tout l'audit a tourné en local, avec
  Supabase, IMAP et SMTP simulés. Restent à confirmer côté Vercel et OVH : que
  la Row Level Security est bien active, que les en-têtes de sécurité sont
  réellement servis, que les déploiements de préversion ne sont pas ouverts,
  et que le compte OVH est protégé par une double authentification.
- **`api/_lib/imap.js` (733 lignes) n'a que 12 tests, tous sur des fonctions
  pures.** Le décodage MIME d'un message hostile — pièces jointes, encodages,
  structures imbriquées — n'est pas couvert. C'est le prochain morceau à
  éprouver de la même façon que le nettoyeur HTML.

---

_Rappel : ce document couvre les fondamentaux. Pour un enjeu contractuel fort (CGL) ou une configuration particulière, un contrôle par un professionnel du droit reste recommandé._
