/*
 * Start page: parts slide in when they scroll into view, and the top bar gets its line once the page moves.
 * No cookies, no storage, no requests. The <head> adds the class "js" first, so nothing hides without this file;
 * where the browser has no IntersectionObserver everything is simply shown.
 */
(function () {
  'use strict';

  var items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    for (var i = 0; i < items.length; i++) items[i].classList.add('is-in');
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    for (var j = 0; j < items.length; j++) observer.observe(items[j]);
  }

  var bar = document.querySelector('.topbar');
  if (bar) {
    var update = function () {
      bar.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
  }
})();
