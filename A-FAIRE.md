# Maison Solstice — Étapes à faire

Mémo des actions qui restent à faire **une seule fois** pour que le site soit
pleinement opérationnel et visible sur Google. Rien ici n'est urgent : le site
est déjà en ligne et accessible.

---

## 1. Activer le back-office (devis par e-mail) — ~15 min

Suivez le guide détaillé **[SETUP-BACKOFFICE.md](./SETUP-BACKOFFICE.md)** :
base de données Supabase, envoi Gmail, variables Vercel. Tant que ce n'est pas
fait, le formulaire de devis affiche « service non activé ».

---

## 2. Vérifier que le site est bien public

Sur Vercel → **Settings → Deployment Protection** : doit être sur **Disabled**
(public). Si « Vercel Authentication » est activé, le site demande une
connexion et personne d'autre que vous ne peut le voir.

> ✅ Vérifié : `https://maison-solstice.fr` s'ouvre sans mur de connexion.

---

## 3. Référencer le site sur Google (Google Search Console)

Le blocage `noindex` a été retiré : Google a désormais le **droit** d'indexer
le site. Pour que ça aille vite (sinon l'indexation naturelle peut prendre
plusieurs semaines) :

1. Allez sur **[search.google.com/search-console](https://search.google.com/search-console)**
   et connectez-vous avec votre compte Google.
2. **Ajouter une propriété** → type **« Préfixe de l'URL »** → entrez l'adresse
   exacte du site :
   `https://maison-solstice.fr`
3. **Validation** : choisissez la méthode **« Balise HTML »**. Google affiche
   une balise du type `<meta name="google-site-verification" content="…">`.
   → **Copiez-la et envoyez-la moi** : je l'ajoute dans le `<head>` du site, on
   redéploie, puis vous cliquez « Valider ». (Aucune manipulation technique de
   votre côté.)
4. Une fois la propriété validée : menu **Sitemaps** → tapez `sitemap.xml` →
   **Envoyer**. Google connaît alors toutes vos pages et commence à les
   indexer.
5. Ensuite, vous pourrez suivre dans « Résultats de recherche » les mots-clés
   qui amènent des visiteurs, et forcer l'indexation d'une page précise via
   « Inspection de l'URL ».

> Le domaine `maison-solstice.fr` est déjà en place : c'est bien lui qu'on
> référence (et non l'ancienne adresse en `.vercel.app`).

---

## 4. Compléter les textes « [à compléter] »

Quelques éléments à personnaliser dans les pages :

- **À propos** : prénom + histoire du projet (blocs marqués `[à compléter]`).
- **Mentions légales** : nom / statut juridique, SIRET, adresse de l'éditeur.
- **Contact** : liens réels **Instagram** et **TikTok** (actuellement `#`).

---

## 5. Nom de domaine — ✅ fait

Le domaine **`maison-solstice.fr`** (acheté chez OVHcloud) est connecté à
Vercel : enregistrement **A** de la racine + **CNAME** `www`. Le site répond sur
`https://maison-solstice.fr` (et `www` redirige dessus). Le `sitemap.xml` et le
`robots.txt` pointent désormais sur ce domaine.

> À penser quand le back-office sera activé : régler la variable Vercel
> `PUBLIC_BASE_URL` = `https://maison-solstice.fr` (pour les liens dans les
> e-mails de devis).
