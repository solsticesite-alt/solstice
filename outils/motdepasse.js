#!/usr/bin/env node
// Fabrique l'empreinte a coller dans la variable Vercel ADMIN_PASSWORD_HASH.
//
//   npm run motdepasse
//
// Le mot de passe est demande sans etre affiche, et n'est ecrit nulle part :
// ni dans le terminal, ni dans un fichier, ni dans l'historique du shell.
// Seule l'empreinte sort — et elle ne permet pas de retrouver le mot de passe.

const readline = require('readline');
const secret = require('../api/_lib/secret');

function demander(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // On masque la frappe : rien ne doit rester lisible a l'ecran.
    const sortie = process.stdout;
    let masque = false;
    rl._writeToOutput = function (s) {
      if (!masque) { sortie.write(s); return; }
      if (s === '\r\n' || s === '\n' || s === '\r') { sortie.write(s); return; }
      sortie.write('*');
    };
    rl.question(question, (rep) => { rl.close(); resolve(rep); });
    masque = true;
  });
}

(async () => {
  console.log('\n  Maison Solstice — empreinte du mot de passe du back-office\n');

  const a = await demander('  Mot de passe : ');
  const b = await demander('  Repeter      : ');

  if (a !== b) {
    console.error('\n  Les deux saisies different. Rien n a ete produit.\n');
    process.exit(1);
  }
  if (a.length < 12) {
    console.error('\n  Trop court : douze caracteres au minimum. Ce mot de passe ouvre le');
    console.error('  fichier de tes clients, il merite une phrase entiere.\n');
    process.exit(1);
  }

  const empreinte = secret.hacher(a);

  console.log('\n  Colle ceci dans Vercel -> Settings -> Environment Variables :\n');
  console.log('    Nom    : ADMIN_PASSWORD_HASH');
  console.log('    Valeur : ' + empreinte + '\n');
  console.log('  Puis SUPPRIME la variable ADMIN_PASSWORD, et redeploie.');
  console.log('  Toutes les sessions ouvertes se fermeront d elles-memes.\n');
})();
