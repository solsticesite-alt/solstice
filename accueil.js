  document.documentElement.classList.add('js');
  var head=document.getElementById('head');
  var onScroll=function(){head.classList.toggle('stuck',window.scrollY>40);};
  onScroll();window.addEventListener('scroll',onScroll,{passive:true});

  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els=document.querySelectorAll('.reveal');
  if(reduce||!('IntersectionObserver' in window)){els.forEach(function(el){el.classList.add('in');});}
  else{
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
    },{threshold:0.12,rootMargin:'0px 0px -8% 0px'});
    els.forEach(function(el){io.observe(el);});
  }

  document.querySelectorAll('.fav').forEach(function(b){
    b.addEventListener('click',function(e){e.preventDefault();b.classList.toggle('on');});
  });

  var panel=document.getElementById('mpanel');
  var openM=function(){panel.classList.add('open');document.body.style.overflow='hidden';};
  var closeM=function(){panel.classList.remove('open');document.body.style.overflow='';};
  document.getElementById('burger').addEventListener('click',openM);
  document.getElementById('mclose').addEventListener('click',closeM);
  panel.querySelectorAll('a').forEach(function(a){a.addEventListener('click',closeM);});
