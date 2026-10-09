/* ClimateShield AI — Motion and polish enhancements. Load AFTER script.js.
 * Non-blocking visual interactions and accessibility enhancements. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => document.querySelector(s);
  const body = document.body;

  /* Intro animation: plays on load and on view changes */
  let timer;
  const intro = () => {
    if (reduce) return;
    body.classList.remove('intro');
    void body.offsetWidth;
    body.classList.add('intro');
    clearTimeout(timer);
    timer = setTimeout(() => body.classList.remove('intro'), 1700);
  };
  intro();
  document.addEventListener('click', e => {
    if (e.target.closest('[data-nav],[data-goto]')) intro();
  });

  /* Count-up for KPI numbers */
  const ease = x => 1 - Math.pow(1 - x, 3);
  function countUp(el, dur = 900) {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /\d/.test(n.nodeValue));
    const end = node ? parseInt(node.nodeValue, 10) : NaN;
    if (!Number.isFinite(end) || reduce) return;
    const t0 = performance.now();
    const step = now => {
      const p = Math.min((now - t0) / dur, 1);
      node.nodeValue = Math.round(end * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Run count-up after DOM renders
  setTimeout(() => {
    document.querySelectorAll('.metric-value, .d-total').forEach(el => countUp(el));
  }, 300);

  /* Sticky header shadow on scroll */
  const bar = $('.topbar');
  if (bar) {
    window.addEventListener('scroll', () => bar.classList.toggle('is-scrolled', window.scrollY > 4), { passive: true });
  }

  /* Keyboard shortcut: "/" focuses global search */
  const gs = $('#globalSearch');
  if (gs) {
    const searchContainer = gs.closest('.search');
    if (searchContainer && !searchContainer.querySelector('kbd')) {
      searchContainer.insertAdjacentHTML('beforeend', '<kbd aria-hidden="true">/</kbd>');
    }
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault();
        gs.focus();
      }
    });
  }
})();