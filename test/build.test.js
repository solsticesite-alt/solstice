// Le déploiement lui-même, mis à l'épreuve.
//
// Ce fichier existe à cause d'une panne réelle, et silencieuse.
//
// `buildCommand` est limité à 256 caractères dans vercel.json. La liste des
// fichiers à copier a fini par les dépasser, d'un seul fichier ajouté. Vercel
// a refusé le build — et comme il garde en ligne le dernier build RÉUSSI, le
// site a continué de fonctionner normalement, avec du code vieux de trois
// commits. Rien, depuis le dépôt, ne permettait de s'en apercevoir : les
// tests passaient, la branche était poussée, `main` était à jour.
//
// Les trois vérifications ci-dessous auraient chacune suffi à le voir.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const conf = JSON.parse(lire('vercel.json'));

/* ---------- 1. la limite qui a mordu ---------- */

test('buildCommand tient sous la limite de 256 caractères de Vercel', () => {
  const cmd = conf.buildCommand || '';
  assert.ok(cmd.length <= 256,
    'buildCommand fait ' + cmd.length + ' caractères — Vercel refuse le build au-delà de 256');
  // Et il reste de la marge : une commande qui frôle la limite la repassera.
  assert.ok(cmd.length <= 200,
    'buildCommand fait ' + cmd.length + ' caractères : trop près de la limite, ' +
    'la prochaine addition la repassera. Passer par un script.');
});

test('le build ne dépend pas d’une liste de fichiers à tenir à jour', () => {
  const cmd = conf.buildCommand || '';
  const fichiersCites = (cmd.match(/[\w-]+\.(?:js|css|svg|html|txt|xml)/g) || [])
    .filter((f) => !f.startsWith('build.'));
  assert.deepStrictEqual(fichiersCites, [],
    'buildCommand énumère des fichiers (' + fichiersCites.join(', ') + ') : ' +
    'chaque ajout au site oblige alors à modifier la configuration, et finit par la casser.');
});

/* ---------- 2. le build produit vraiment ce que les pages réclament ---------- */

function construire() {
  execFileSync(process.execPath, [path.join(RACINE, 'outils', 'build.js')], {
    cwd: RACINE, stdio: 'pipe'
  });
  return path.join(RACINE, 'public');
}

test('le build s’exécute sans erreur', () => {
  assert.doesNotThrow(construire);
});

test('chaque fichier réclamé par une page est bien publié', () => {
  const out = construire();
  const pages = fs.readdirSync(out).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 15, 'seulement ' + pages.length + ' pages publiées');

  const manquants = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="\/([^"?#]+\.(?:js|css))"/g)) {
      if (!fs.existsSync(path.join(out, m[1]))) manquants.push(page + ' → /' + m[1]);
    }
  }
  assert.deepStrictEqual(manquants, [], 'fichiers cités mais absents : ' + manquants.join(' | '));
});

// Les fichiers arrivés récemment sont exactement ceux qui avaient fait
// déborder la commande. Ils doivent être là, nommément.
test('les scripts ajoutés récemment sont publiés', () => {
  const out = construire();
  for (const f of ['pieces.js', 'admin.js', 'catalogue.js', 'accueil.js', 'collections.js']) {
    assert.ok(fs.existsSync(path.join(out, f)), f + ' manque dans public/');
  }
});

test('le fichier .well-known est publié, malgré son point initial', () => {
  const out = construire();
  assert.ok(fs.existsSync(path.join(out, '.well-known', 'security.txt')));
});

/* ---------- 3. et rien de plus que ça ---------- */

test('aucun fichier de configuration ou de code serveur ne part en ligne', () => {
  const out = construire();
  const interdits = ['vercel.json', 'package.json', 'package-lock.json', '.env', 'CLAUDE.md'];
  for (const f of interdits) {
    assert.strictEqual(fs.existsSync(path.join(out, f)), false, f + ' ne doit pas être publié');
  }
  for (const d of ['api', 'test', 'outils', 'node_modules', '.git']) {
    assert.strictEqual(fs.existsSync(path.join(out, d)), false, 'le dossier ' + d + ' ne doit pas être publié');
  }
});

test('les notes internes du projet ne sont pas publiées', () => {
  const out = construire();
  // Ces documents décrivent l'organisation interne et les points faibles connus.
  for (const f of ['A-FAIRE.md', 'SECURITE-RGPD.md', 'VISION.md', 'SETUP-BACKOFFICE.md', 'supabase-schema.sql']) {
    assert.strictEqual(fs.existsSync(path.join(out, f)), false, f + ' ne doit pas être publié');
  }
});

/* ---------- la sortie reste cohérente ---------- */

test('le build repart d’un dossier propre', () => {
  const out = construire();
  const intrus = path.join(out, 'intrus.html');
  fs.writeFileSync(intrus, 'x');
  construire();
  assert.strictEqual(fs.existsSync(intrus), false,
    'un fichier supprimé du dépôt doit disparaître du site au build suivant');
});

test('le dossier publié est ignoré par git', () => {
  assert.match(lire('.gitignore'), /^public\/$/m, 'public/ doit rester hors du dépôt');
});
