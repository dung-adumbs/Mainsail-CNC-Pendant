/* Navigation only: standard Mainsail controls are left untouched. */
(() => {
  function mount() {
    const dashboard = Array.from(document.querySelectorAll('a')).find(a => a.getAttribute('href') === '/' && /dashboard/i.test(a.textContent));
    if (!dashboard || document.getElementById('cnc-pendant-navigation')) return;
    const link = dashboard.cloneNode(true);
    link.id = 'cnc-pendant-navigation'; link.href = '/cnc-pendant.html';
    link.classList.remove('v-list-item--active', 'v-list-item--exact-active');
    link.removeAttribute('aria-current'); link.removeAttribute('aria-selected');
    const label = link.querySelector('.v-list-item__title') || link;
    label.textContent = 'CNC Pendant'; link.setAttribute('aria-label', 'CNC Pendant');
    link.addEventListener('click', event => {event.preventDefault();event.stopImmediatePropagation();location.assign('/cnc-pendant.html');});
    dashboard.after(link);
  }
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
  mount();
})();
