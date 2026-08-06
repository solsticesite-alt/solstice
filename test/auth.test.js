// Session admin : signature du cookie et comparaison du mot de passe.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');

// Le module lit les variables d'environnement a chaque appel : on peut donc
// les changer d'un test a l'autre sans recharger le module.
const auth = require('../api/_lib/auth');

function avec(env, fn) {
  const avant = { SESSION_SECRET: process.env.SESSION_SECRET, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
  try {
    for (const k of Object.keys(env)) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    for (const k of Object.keys(avant)) {
      if (avant[k] === undefined) delete process.env[k];
      else process.env[k] = avant[k];
    }
  }
}

test('un jeton signe avec le bon secret est accepte', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'motdepasse' }, () => {
    assert.strictEqual(auth.verifyToken(auth.makeToken()), true);
  });
});

// Le defaut corrige : un secret de repli etait ecrit en clair dans le depot.
// N'importe qui pouvait forger un cookie valide sur un deploiement ou
// ADMIN_PASSWORD n'etait pas encore renseigne.
test('sans secret configure, aucun jeton n est valable', () => {
  const jeton = avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: undefined }, () => auth.makeToken());
  avec({ SESSION_SECRET: undefined, ADMIN_PASSWORD: undefined }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false, 'le jeton d avant ne passe plus');
    assert.strictEqual(auth.verifyToken(auth.makeToken()), false, 'et on ne peut plus en fabriquer');
    assert.strictEqual(auth.isAuthed({ headers: { cookie: 'sol_admin=' + jeton } }), false);
  });
});

test('un jeton signe avec un autre secret est refuse', () => {
  const jeton = avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: undefined }, () => auth.makeToken());
  avec({ SESSION_SECRET: 'secret-b', ADMIN_PASSWORD: undefined }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false);
  });
});

// Sans SESSION_SECRET, le secret derive du mot de passe : le changer doit
// donc invalider les sessions ouvertes.
test('changer le mot de passe ferme les sessions en cours', () => {
  const jeton = avec({ SESSION_SECRET: undefined, ADMIN_PASSWORD: 'ancien' }, () => auth.makeToken());
  avec({ SESSION_SECRET: undefined, ADMIN_PASSWORD: 'nouveau' }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false);
  });
});

test('un jeton bricole ou tronque est refuse', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: undefined }, () => {
    const bon = auth.makeToken();
    assert.strictEqual(auth.verifyToken(bon.split('.')[0]), false, 'sans signature');
    assert.strictEqual(auth.verifyToken(bon + 'x'), false, 'signature allongee');
    assert.strictEqual(auth.verifyToken('.'), false);
    assert.strictEqual(auth.verifyToken(''), false);
    assert.strictEqual(auth.verifyToken(null), false);
    assert.strictEqual(auth.verifyToken({}), false);
  });
});

test('le mot de passe n est jamais valide par defaut', () => {
  avec({ ADMIN_PASSWORD: undefined, SESSION_SECRET: 'secret-a' }, () => {
    assert.strictEqual(auth.checkPassword(''), false);
    assert.strictEqual(auth.checkPassword('nawak'), false);
  });
  avec({ ADMIN_PASSWORD: 'le-bon', SESSION_SECRET: 'secret-a' }, () => {
    assert.strictEqual(auth.checkPassword('le-bon'), true);
    assert.strictEqual(auth.checkPassword('le-bo'), false, 'longueur differente');
    assert.strictEqual(auth.checkPassword('le-bom'), false, 'meme longueur');
    assert.strictEqual(auth.checkPassword(null), false);
    assert.strictEqual(auth.checkPassword(undefined), false);
  });
});

test('le cookie de session est verrouille', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    let pose = '';
    auth.setSession({ setHeader: (k, v) => { if (k === 'Set-Cookie') pose = v; } });
    assert.match(pose, /HttpOnly/, 'inaccessible au JavaScript de la page');
    assert.match(pose, /Secure/, 'jamais envoye en clair');
    assert.match(pose, /SameSite=Strict/, 'pas de requete inter-sites');
    assert.match(pose, /Path=\//);
  });
});
