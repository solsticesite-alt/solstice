// Session admin : signature du cookie, revocation, comparaison du mot de passe.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');

// Le module lit les variables d'environnement a chaque appel : on peut donc
// les changer d'un test a l'autre sans recharger le module.
const auth = require('../api/_lib/auth');
const secret = require('../api/_lib/secret');

const CLES = ['SESSION_SECRET', 'ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH'];

function avec(env, fn) {
  const avant = {};
  for (const k of CLES) avant[k] = process.env[k];
  try {
    // On part d'une table rase : un test ne doit pas heriter des variables
    // laissees par le precedent.
    for (const k of CLES) delete process.env[k];
    for (const k of Object.keys(env)) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    return fn();
  } finally {
    for (const k of CLES) {
      if (avant[k] === undefined) delete process.env[k];
      else process.env[k] = avant[k];
    }
  }
}

// Un faux `res` qui accumule les cookies comme le ferait Node.
function faussRes() {
  const entetes = {};
  return {
    setHeader(k, v) { entetes[k] = v; },
    getHeader(k) { return entetes[k]; },
    cookies() {
      const v = entetes['Set-Cookie'];
      return v == null ? [] : (Array.isArray(v) ? v : [v]);
    },
    cookieNomme(nom) {
      return this.cookies().find((c) => c.indexOf(nom + '=') === 0) || '';
    }
  };
}

const req = (cookie) => ({ headers: cookie ? { cookie } : {} });

/* ---------------- signature ---------------- */

test('un jeton signe avec le bon secret est accepte', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'motdepasse' }, () => {
    assert.strictEqual(auth.verifyToken(auth.makeToken()), true);
  });
});

// Le defaut corrige : un secret de repli etait ecrit en clair dans le depot.
// N'importe qui pouvait forger un cookie valide sur un deploiement ou
// ADMIN_PASSWORD n'etait pas encore renseigne.
test('sans secret configure, aucun jeton n est valable', () => {
  const jeton = avec({ SESSION_SECRET: 'secret-a' }, () => auth.makeToken());
  avec({}, () => {
    assert.strictEqual(auth.verifyToken(jeton), false, 'le jeton d avant ne passe plus');
    assert.strictEqual(auth.verifyToken(auth.makeToken()), false, 'et on ne peut plus en fabriquer');
    assert.strictEqual(auth.isAuthed(req('sol_admin=' + jeton)), false);
  });
});

test('un jeton signe avec un autre secret est refuse', () => {
  const jeton = avec({ SESSION_SECRET: 'secret-a' }, () => auth.makeToken());
  avec({ SESSION_SECRET: 'secret-b' }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false);
  });
});

test('un jeton bricole ou tronque est refuse', () => {
  avec({ SESSION_SECRET: 'secret-a' }, () => {
    const bon = auth.makeToken();
    assert.strictEqual(auth.verifyToken(bon.split('.')[0]), false, 'sans signature');
    assert.strictEqual(auth.verifyToken(bon + 'x'), false, 'signature allongee');
    assert.strictEqual(auth.verifyToken('.'), false);
    assert.strictEqual(auth.verifyToken(''), false);
    assert.strictEqual(auth.verifyToken(null), false);
    assert.strictEqual(auth.verifyToken({}), false);
    // Contenu modifie, signature d'origine conservee : elle ne colle plus.
    // On repart du contenu reel plutot que d'en refabriquer un — un contenu
    // reconstruit peut tomber identique a l'original et le test ne prouve
    // alors plus rien.
    const [payload, sig] = bon.split('.');
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    data.iat = data.iat + 1000;
    const modifie = Buffer.from(JSON.stringify(data)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.notStrictEqual(modifie, payload, 'le contenu doit vraiment differer');
    assert.strictEqual(auth.verifyToken(modifie + '.' + sig), false);
  });
});

/* ---------------- changement de mot de passe ---------------- */

// C'est le defaut constate en production : le mot de passe avait ete change,
// et la session ouverte continuait de fonctionner. Elle tenait a SESSION_SECRET,
// qui lui n'avait pas bouge. L'empreinte du mot de passe entre desormais dans
// la cle de signature, donc le changer coupe tout, avec ou sans SESSION_SECRET.
test('changer le mot de passe ferme les sessions — MEME avec SESSION_SECRET fixe', () => {
  const jeton = avec({ SESSION_SECRET: 'secret-stable', ADMIN_PASSWORD: 'ancien' }, () => auth.makeToken());
  avec({ SESSION_SECRET: 'secret-stable', ADMIN_PASSWORD: 'ancien' }, () => {
    assert.strictEqual(auth.verifyToken(jeton), true, 'temoin : le jeton vaut bien pour l ancien mot de passe');
  });
  avec({ SESSION_SECRET: 'secret-stable', ADMIN_PASSWORD: 'nouveau' }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false, 'apres changement, le jeton doit tomber');
    assert.strictEqual(auth.isAuthed(req('sol_admin=' + jeton)), false);
  });
});

test('changer le mot de passe ferme les sessions sans SESSION_SECRET non plus', () => {
  const jeton = avec({ ADMIN_PASSWORD: 'ancien' }, () => auth.makeToken());
  avec({ ADMIN_PASSWORD: 'nouveau' }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false);
  });
});

test('passer du mot de passe en clair a son empreinte ferme aussi les sessions', () => {
  const jeton = avec({ SESSION_SECRET: 's', ADMIN_PASSWORD: 'abc' }, () => auth.makeToken());
  const hash = secret.hacher('abc');
  avec({ SESSION_SECRET: 's', ADMIN_PASSWORD_HASH: hash }, () => {
    assert.strictEqual(auth.verifyToken(jeton), false);
  });
});

/* ---------------- revocation par generation ---------------- */

test('un jeton d une generation anterieure est refuse', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const jeton = auth.makeToken(3);
    assert.strictEqual(auth.verifyToken(jeton, 3), true, 'valable pour sa generation');
    assert.strictEqual(auth.verifyToken(jeton, 4), false, 'plus rien apres « deconnecter partout »');
    assert.strictEqual(auth.verifyToken(jeton, 2), false, 'ni pour une generation anterieure');
    assert.strictEqual(auth.isAuthed(req('sol_admin=' + jeton), 4), false);
  });
});

// Le numero de generation est dans le contenu signe : le remonter a la main
// casse la signature.
test('on ne peut pas se hisser a la generation courante en editant le jeton', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const ancien = auth.makeToken(1);
    const [payload, sig] = ancien.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    data.gen = 2;
    const truque = Buffer.from(JSON.stringify(data)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.strictEqual(auth.verifyToken(truque + '.' + sig, 2), false);
  });
});

/* ---------------- jeton d etape (2FA) ---------------- */

test('le jeton d etape n ouvre pas de session, et inversement', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const etape = auth.makeToken(0, { kind: 'p' });
    const session = auth.makeToken(0, { kind: 's' });

    assert.strictEqual(auth.isAuthed(req('sol_admin=' + etape)), false,
      'le mot de passe seul ne doit pas ouvrir le back-office');
    assert.strictEqual(auth.etapePassee(req('sol_admin_2fa=' + session)), false,
      'et une session complete n est pas une preuve d etape');

    assert.strictEqual(auth.isAuthed(req('sol_admin=' + session)), true);
    assert.strictEqual(auth.etapePassee(req('sol_admin_2fa=' + etape)), true);
  });
});

test('le jeton d etape perime au bout de cinq minutes', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const vieux = auth.makeToken(0, { kind: 'p', iat: Date.now() - (auth.MAX_AGE_ETAPE + 5) * 1000 });
    assert.strictEqual(auth.etapePassee(req('sol_admin_2fa=' + vieux)), false);
    const frais = auth.makeToken(0, { kind: 'p', iat: Date.now() - 60 * 1000 });
    assert.strictEqual(auth.etapePassee(req('sol_admin_2fa=' + frais)), true);
  });
});

test('une session trop vieille est refusee', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const vieux = auth.makeToken(0, { kind: 's', iat: Date.now() - (auth.MAX_AGE + 60) * 1000 });
    assert.strictEqual(auth.verifyToken(vieux), false);
  });
});

/* ---------------- mot de passe ---------------- */

test('le mot de passe n est jamais valide par defaut', () => {
  avec({ SESSION_SECRET: 'secret-a' }, () => {
    assert.strictEqual(auth.checkPassword(''), false);
    assert.strictEqual(auth.checkPassword('nawak'), false);
  });
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'le-bon' }, () => {
    assert.strictEqual(auth.checkPassword('le-bon'), true);
    assert.strictEqual(auth.checkPassword('le-bo'), false, 'longueur differente');
    assert.strictEqual(auth.checkPassword('le-bom'), false, 'meme longueur');
    assert.strictEqual(auth.checkPassword(null), false);
    assert.strictEqual(auth.checkPassword(undefined), false);
  });
});

test('le mot de passe stocke en empreinte fonctionne, et prime sur le clair', () => {
  const hash = secret.hacher('vrai-mot-de-passe');
  avec({ SESSION_SECRET: 's', ADMIN_PASSWORD_HASH: hash }, () => {
    assert.strictEqual(auth.checkPassword('vrai-mot-de-passe'), true);
    assert.strictEqual(auth.checkPassword('autre'), false);
    assert.strictEqual(auth.checkPassword(''), false);
  });
  // Si les deux sont poses, l'empreinte fait foi : on ne veut pas qu'un vieux
  // ADMIN_PASSWORD oublie dans la configuration continue d'ouvrir.
  avec({ SESSION_SECRET: 's', ADMIN_PASSWORD_HASH: hash, ADMIN_PASSWORD: 'ancien-oublie' }, () => {
    assert.strictEqual(auth.checkPassword('vrai-mot-de-passe'), true);
    assert.strictEqual(auth.checkPassword('ancien-oublie'), false, 'le clair ne doit plus ouvrir');
  });
});

test('une empreinte illisible n ouvre rien', () => {
  for (const mauvais of ['scrypt$bidon', 'pas-un-hash', 'scrypt$1$1$1$$', '']) {
    avec({ SESSION_SECRET: 's', ADMIN_PASSWORD_HASH: mauvais }, () => {
      assert.strictEqual(auth.checkPassword(''), false, JSON.stringify(mauvais));
      assert.strictEqual(auth.checkPassword('quoi que ce soit'), false, JSON.stringify(mauvais));
    });
  }
});

test('motDePasseConfigure voit les deux formes', () => {
  avec({}, () => assert.strictEqual(auth.motDePasseConfigure(), false));
  avec({ ADMIN_PASSWORD: 'x' }, () => assert.strictEqual(auth.motDePasseConfigure(), true));
  avec({ ADMIN_PASSWORD_HASH: secret.hacher('x') }, () => assert.strictEqual(auth.motDePasseConfigure(), true));
});

/* ---------------- cookies ---------------- */

test('le cookie de session est verrouille', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const res = faussRes();
    auth.setSession(res, 0);
    const c = res.cookieNomme('sol_admin');
    assert.match(c, /HttpOnly/, 'inaccessible au JavaScript de la page');
    assert.match(c, /Secure/, 'jamais envoye en clair');
    assert.match(c, /SameSite=Strict/, 'pas de requete inter-sites');
    assert.match(c, /Path=\//);
  });
});

test('ouvrir une session efface le jeton d etape', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const res = faussRes();
    auth.setEtape(res, 0);
    auth.setSession(res, 0);
    const etape = res.cookies().filter((c) => c.indexOf('sol_admin_2fa=') === 0);
    assert.ok(etape.length >= 1);
    assert.match(etape[etape.length - 1], /Max-Age=0/, 'le dernier ordre doit l effacer');
  });
});

test('la deconnexion efface les deux cookies', () => {
  avec({ SESSION_SECRET: 'secret-a', ADMIN_PASSWORD: 'x' }, () => {
    const res = faussRes();
    auth.clearSession(res);
    const cookies = res.cookies();
    assert.strictEqual(cookies.length, 2);
    for (const c of cookies) assert.match(c, /Max-Age=0/);
    assert.ok(cookies.some((c) => c.indexOf('sol_admin=') === 0));
    assert.ok(cookies.some((c) => c.indexOf('sol_admin_2fa=') === 0));
  });
});
