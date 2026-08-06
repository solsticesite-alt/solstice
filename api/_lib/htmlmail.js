// Mise en forme sure du corps d'un e-mail recu.
//
// Un e-mail est du HTML ecrit par un inconnu : on ne peut pas l'injecter tel
// quel dans le back-office. Deux protections se superposent :
//
//   1. ici, un nettoyage du balisage (scripts, gestionnaires d'evenements,
//      URL executables) et la mise de cote des images distantes ;
//   2. cote navigateur, l'affichage dans une iframe `sandbox` sans script ni
//      acces a l'origine — c'est la protection qui compte vraiment, celle-ci
//      n'en est que le premier filet.

const { escapeHtml } = require('./util');

/* Elements retires avec leur contenu : rien de leur interieur n'a de sens
   dans un lecteur de courrier. */
const DROP = ['script', 'iframe', 'object', 'embed', 'applet', 'form', 'svg', 'math', 'noscript', 'template'];
/* Balises orphelines a retirer (pas de contenu a supprimer). */
const DROP_VOID = ['base', 'meta', 'link'];

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'xlink:href', 'background', 'poster'];

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function stripElements(html) {
  let out = html;
  DROP.forEach((tag) => {
    out = out.replace(new RegExp('<' + tag + '\\b[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), '');
    // Balise ouverte jamais refermee : on coupe jusqu'a la fin.
    out = out.replace(new RegExp('<' + tag + '\\b[\\s\\S]*$', 'gi'), '');
  });
  DROP_VOID.forEach((tag) => {
    out = out.replace(new RegExp('<' + tag + '\\b[^>]*>', 'gi'), '');
  });
  return out;
}

/* Le CSS des e-mails porte souvent la mise en page : on le garde, mais on en
   retire ce qui peut aller chercher une ressource ou s'executer. */
function cleanCss(css) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/url\(\s*['"]?\s*(javascript|vbscript|data:text\/html)[^)]*\)/gi, 'none')
    .replace(/behavior\s*:[^;]*/gi, '')
    .replace(/-moz-binding\s*:[^;]*/gi, '');
}

function cleanStyleBlocks(html) {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (m, attrs, css) => '<style>' + cleanCss(css) + '</style>');
}

/* Le navigateur decode les entites dans une valeur d'attribut : sans cette
   etape, « javascript&#58;alert(1) » passerait pour une URL anodine. */
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (m, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&(tab|newline);/gi, '');
}

/* Liste blanche plutot que liste noire : on n'autorise que les schemas dont on
   sait qu'ils sont inoffensifs, et tout le reste est refuse par defaut. */
const SCHEMES_SURS = ['http', 'https', 'mailto', 'tel', 'cid'];

function isDangerousUrl(url) {
  const v = decodeEntities(url).replace(/[\s\u0000-\u001F]/g, '').toLowerCase();
  const m = /^([a-z][a-z0-9+.-]*):/.exec(v);
  if (!m) return false; // URL relative, ancre ou vide : sans danger
  if (SCHEMES_SURS.indexOf(m[1]) >= 0) return false;
  if (m[1] === 'data') return !/^data:image\/(png|jpe?g|gif|webp|bmp)[;,]/.test(v);
  return true;
}

/* Nettoie les attributs d'une balise ouvrante. */
function cleanAttributes(tagName, attrs, opts) {
  let out = attrs;

  // Gestionnaires d'evenements, sous toutes leurs formes de guillemets.
  out = out.replace(/\son[a-z-]+\s*=\s*"[^"]*"/gi, '')
           .replace(/\son[a-z-]+\s*=\s*'[^']*'/gi, '')
           .replace(/\son[a-z-]+\s*=\s*[^\s>]+/gi, '');

  // style="" en ligne : meme traitement que les blocs <style>.
  out = out.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (m, css) => ' style="' + cleanCss(css).replace(/"/g, '') + '"')
           .replace(/\sstyle\s*=\s*'([^']*)'/gi, (m, css) => " style='" + cleanCss(css).replace(/'/g, '') + "'");

  // URL executables.
  URL_ATTRS.forEach((a) => {
    const re = new RegExp('\\s' + a.replace(':', '\\:') + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'gi');
    out = out.replace(re, (m, _q, d, s, u) => {
      const url = d != null ? d : (s != null ? s : (u || ''));
      if (isDangerousUrl(url)) return '';
      // Les images distantes attendent un clic : elles pistent la lecture.
      if (a === 'src' && tagName === 'img' && /^https?:/i.test(url.trim())) {
        opts.blocked++;
        return ' data-osrc="' + escapeHtml(url) + '"';
      }
      if (a === 'background' && /^https?:/i.test(url.trim())) { opts.blocked++; return ''; }
      return m;
    });
  });

  return out;
}

/* Trouve la fin d'une balise ouvrante en suivant l'automate HTML : un
   guillemet n'ouvre une valeur que juste apres un « = ». Une expression
   reguliere qui exige des guillemets apparies laisse au contraire passer
   `<a href="..." x=y">` en entier — donc sans aucun nettoyage. */
function endOfTag(html, from) {
  let quote = null;
  let afterEq = false;
  for (let j = from; j < html.length; j++) {
    const ch = html[j];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '>') return j;
    if ((ch === '"' || ch === "'") && afterEq) { quote = ch; afterEq = false; continue; }
    if (ch === '=') { afterEq = true; continue; }
    if (!/\s/.test(ch)) afterEq = false;
  }
  return -1;
}

/* Parcourt le balisage et remet chaque balise ouvrante entre les mains de
   `onTag`. Ce qui ne s'analyse pas est jete, jamais recopie tel quel. */
function walkTags(html, onTag) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); break; }
    out += html.slice(i, lt);
    const rest = html.slice(lt, lt + 64);

    const close = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (close) {
      const end = html.indexOf('>', lt);
      if (end < 0) break;
      out += '</' + close[1] + '>';
      i = end + 1;
      continue;
    }

    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (open) {
      const end = endOfTag(html, lt + open[0].length);
      if (end < 0) break; // balise jamais refermee : on abandonne la suite
      out += onTag(open[1], html.slice(lt + open[0].length, end));
      i = end + 1;
      continue;
    }

    // Ni balise ouvrante ni fermante : un « < » litteral.
    out += '&lt;';
    i = lt + 1;
  }
  return out;
}

const WRAPPERS = { html: 1, head: 1, body: 1 };

function sanitizeEmailHtml(html) {
  if (!html) return { html: '', blocked: 0 };
  const opts = { blocked: 0 };
  let out = String(html);
  out = stripComments(out);
  out = stripElements(out);
  out = cleanStyleBlocks(out);

  out = walkTags(out, (tag, attrs) => {
    const name = tag.toLowerCase();
    if (WRAPPERS[name]) return '';
    if (DROP.indexOf(name) >= 0 || DROP_VOID.indexOf(name) >= 0) return '';
    let a = cleanAttributes(name, attrs, opts);
    // Un lien s'ouvre a cote, sans transmettre la page d'origine.
    if (name === 'a' && /\shref\s*=/i.test(a)) {
      a = a.replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      a += ' target="_blank" rel="noopener noreferrer nofollow"';
    }
    return '<' + tag + a + '>';
  });

  // Enveloppe html/head/body : on ne garde que le contenu utile.
  out = out.replace(/<\/(html|head|body)\s*>/gi, '');
  return { html: out, blocked: opts.blocked };
}

/* Un message en texte brut, rendu lisible : liens cliquables et citations
   mises en retrait, comme dans n'importe quel client mail. */
function textToHtml(text) {
  if (!text) return '';
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let quoting = false;
  lines.forEach((line) => {
    const isQuote = /^\s*>/.test(line);
    if (isQuote && !quoting) { out.push('<blockquote class="q">'); quoting = true; }
    if (!isQuote && quoting) { out.push('</blockquote>'); quoting = false; }
    const body = escapeHtml(line.replace(/^\s*>+\s?/, ''))
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
      .replace(/\b([\w.+-]+@[\w-]+\.[\w.-]{2,})\b/g, '<a href="mailto:$1">$1</a>');
    out.push(body || '&nbsp;');
    out.push('<br>');
  });
  if (quoting) out.push('</blockquote>');
  return out.join('\n');
}

/* Corps du message pret a etre affiche, quelle que soit sa forme d'origine. */
function renderBody(message) {
  if (message.html) {
    const s = sanitizeEmailHtml(message.html);
    return { html: s.html, blockedImages: s.blocked, kind: 'html' };
  }
  return { html: textToHtml(message.text), blockedImages: 0, kind: 'text' };
}

module.exports = {
  renderBody, textToHtml,
  // Couverts par test/htmlmail.test.js
  sanitizeEmailHtml, isDangerousUrl
};
