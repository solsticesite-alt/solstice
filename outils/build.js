#!/usr/bin/env node
/*
 * Assemble le dossier `public/` que Vercel met en ligne.
 *
 * Pourquoi un script plutôt qu'une ligne de commande : `buildCommand` est
 * limité à 256 caractères dans vercel.json, et la liste des fichiers à copier
 * l'avait dépassée sans bruit. Le build échouait, Vercel gardait en ligne le
 * dernier build réussi — donc le site continuait de fonctionner, avec du code
 * vieux de plusieurs commits. Rien ne le signalait depuis le dépôt.
 *
 * Ici la règle remplace la liste : tout ce qui est destiné au navigateur est
 * pris par extension. Ajouter une page ou un script ne demande plus de
 * toucher à la configuration, donc ne peut plus casser le déploiement.
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'public');

/* Ce qui part en ligne, par extension. Le reste (package.json, vercel.json,
   les tests, /api, /outils) n'a rien à faire dans un dossier public. */
const EXTENSIONS = ['.html', '.js', '.css', '.svg', '.txt', '.xml', '.webmanifest', '.ico'];

/* Ces fichiers vivent à la racine pour des raisons d'outillage, pas pour être
   servis. Les publier exposerait la configuration du projet. */
const JAMAIS = new Set(['vercel.json', 'package.json', 'package-lock.json']);

function copier(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  fs.rmSync(SORTIE, { recursive: true, force: true });
  fs.mkdirSync(SORTIE, { recursive: true });

  const copies = [];

  for (const nom of fs.readdirSync(RACINE)) {
    if (JAMAIS.has(nom)) continue;
    const src = path.join(RACINE, nom);
    if (!fs.statSync(src).isFile()) continue;
    if (!EXTENSIONS.includes(path.extname(nom).toLowerCase())) continue;
    copier(src, path.join(SORTIE, nom));
    copies.push(nom);
  }

  // .well-known n'est pas à la racine du listing : il commence par un point.
  const wk = path.join(RACINE, '.well-known');
  if (fs.existsSync(wk)) {
    for (const nom of fs.readdirSync(wk)) {
      copier(path.join(wk, nom), path.join(SORTIE, '.well-known', nom));
      copies.push('.well-known/' + nom);
    }
  }

  /* Garde-fou : chaque <script src="/x.js"> et <link href="/x.css"> cité par
     une page doit exister dans public/. C'est exactement ce qui manquait —
     un fichier oublié ne cassait rien au build, seulement le site. */
  const manquants = [];
  for (const nom of copies.filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(SORTIE, nom), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="\/([^"?#]+\.(?:js|css))"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (!fs.existsSync(path.join(SORTIE, ref))) manquants.push(nom + ' → /' + ref);
    }
  }
  if (manquants.length) {
    console.error('\nDes pages réclament des fichiers absents du dossier publié :');
    manquants.forEach((m) => console.error('  · ' + m));
    process.exit(1);
  }

  console.log('public/ : ' + copies.length + ' fichiers');
}

main();
