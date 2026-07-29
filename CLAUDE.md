# Maison Solstice — contexte projet

Site vitrine de **Maison Solstice**, maison de création événementielle à Amiens
(location de mobilier, décoration, accompagnement). La marque vend une
**atmosphère / un art de vivre**, pas un catalogue d'objets.

## Documents de référence (à lire avant de travailler)
- **`VISION.md`** — ADN de la marque + feuille de route (dès le début vs pour
  la suite). Source de vérité pour toute décision produit/contenu.
- **`A-FAIRE.md`** — checklist de mise en ligne (back-office, site public,
  Google Search Console, domaine).
- **`SETUP-BACKOFFICE.md`** — installation du back-office devis (Supabase,
  Gmail, variables Vercel).
- **`SECURITE-RGPD.md`** — notes sécurité / RGPD.

## Nature technique
- Site **statique** : HTML par page + `site.css` + `site.js` + `cart.js`.
  Build Vercel : copie des fichiers vers `public/` (voir `vercel.json`).
- Back-office « sur devis » : fonctions serverless dans `/api`
  (Supabase + nodemailer + pdfkit). Pas de paiement en ligne.
- Deux univers : **Solstice d'Été** / **Solstice d'Hiver** (jeu de mots sur le
  solstice — ce ne sont PAS le nom de la marque, ne pas les renommer).

## Conventions
- Contenu et interface **en français**.
- Le nom de marque est **« Maison Solstice »** (jamais « Solstice » seul pour
  désigner la maison). Ne pas toucher aux identifiants techniques
  (classes CSS `.cta-solstice`, handle `@solstice.evenements`, domaine).
- Rester fidèle aux **principes directeurs** de `VISION.md` (vendre une
  atmosphère ; le site est une expérience ; accompagnement au choix).
