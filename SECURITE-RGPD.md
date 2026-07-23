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
| **Vercel Inc.** | Hébergement | Oui (USA) | Vérifier le DPA Vercel (clauses contractuelles types) |
| [Service e-mail / formulaire] | Réception des demandes | À vérifier | Choisir un prestataire UE si possible ; signer le DPA |
| [Mesure d'audience] | Statistiques | À vérifier | Privilégier une solution sans cookie / UE |
| [Comptable / facturation] | Administratif | Non | DPA |

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

_Rappel : ce document couvre les fondamentaux. Pour un enjeu contractuel fort (CGL) ou une configuration particulière, un contrôle par un professionnel du droit reste recommandé._
