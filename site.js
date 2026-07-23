/* Solstice — comportements partagés */
(function () {
  document.documentElement.classList.add('js');

  // Header : transparent en haut, plein au défilement
  var head = document.getElementById('head');
  if (head) {
    var onScroll = function () {
      var top = window.scrollY < 20;
      head.classList.toggle('at-top', top && head.hasAttribute('data-hero'));
      head.classList.toggle('stuck', !top);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Apparition au défilement
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  // Favoris (démo)
  document.querySelectorAll('.fav').forEach(function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); b.classList.toggle('on'); });
  });

  // Menu mobile
  var panel = document.getElementById('mpanel');
  var burger = document.getElementById('burger');
  if (panel && burger) {
    var open = function () { panel.classList.add('open'); document.body.style.overflow = 'hidden'; };
    var close = function () { panel.classList.remove('open'); document.body.style.overflow = ''; };
    burger.addEventListener('click', open);
    var mclose = document.getElementById('mclose');
    if (mclose) mclose.addEventListener('click', close);
    panel.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
  }

  // Accordéon FAQ
  document.querySelectorAll('.faq-q').forEach(function (q) {
    q.addEventListener('click', function () {
      var item = q.closest('.faq-item');
      if (item) item.classList.toggle('open');
    });
  });
})();
