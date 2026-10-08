// Reuse the original controls and handlers in a compact native layout.
let searchOpen = false;
let filtersOpen = false;
const compact = window.matchMedia('(max-width:767px)');
export function setupMobileContent() {
  const shotToolbar = document.querySelector('.shot-toolbar');
  if (shotToolbar) {
    let details = document.querySelector('.desk-shot-filters');
    if (!details) {
      details = document.createElement('details');
      details.className = 'desk-shot-filters';
      const summary = document.createElement('summary');
      summary.textContent = 'Filters & timing';
      shotToolbar.before(details); details.append(summary,shotToolbar);
      details.addEventListener('toggle', () => { if (compact.matches) filtersOpen = details.open; });
    }
    details.open = !compact.matches || filtersOpen;
  }
  const toolbar = document.querySelector('.script-toolbar');
  if (!toolbar) return;
  const field = toolbar.querySelector('#scene-search');
  let button = toolbar.querySelector('#desk-search-toggle');
  if (!button) {
    button = document.createElement('button');
    button.id = 'desk-search-toggle'; button.type = 'button';
    button.setAttribute('aria-label', 'Search script');
    button.setAttribute('aria-controls', 'scene-search');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>';
    toolbar.append(button);
    button.onclick = () => {
      searchOpen = !searchOpen;
      toolbar.classList.toggle('desk-search-open', searchOpen);
      button.setAttribute('aria-expanded', String(searchOpen));
      if (searchOpen) field.focus();
    };
  }
  if (field.value) searchOpen = true;
  toolbar.classList.toggle('desk-search-open', searchOpen);
  button.setAttribute('aria-expanded', String(searchOpen));
  const selection = document.querySelector('.script-selection');
  if (compact.matches) document.querySelector('.script-scroll').after(selection);
  else toolbar.after(selection);
}
compact.addEventListener('change', setupMobileContent);
export function setupMobileLayout() {
  const sidebar = document.querySelector('.sidebar');
  const brand = sidebar.querySelector('.brand');
  const header = document.createElement('div');
  header.className = 'desk-brandbar';
  const toggle = document.createElement('button');
  toggle.id = 'production-tools-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Production tools');
  toggle.setAttribute('aria-controls', 'production-tools-panel');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span aria-hidden="true">•••</span>';
  sidebar.prepend(header);
  header.append(brand, toggle);
  header.append(sidebar.querySelector('.software-credit'));

  const switcher = document.createElement('div');
  switcher.className = 'desk-production-switcher';
  const label = sidebar.querySelector('.project-label');
  const picker = sidebar.querySelector('#project-picker');
  switcher.append(label, picker);
  header.after(switcher);

  const panel = document.createElement('div');
  panel.id = 'production-tools-panel';
  panel.hidden = true;
  sidebar.append(panel);
  for (const el of [...sidebar.children]) {
    if (el !== header && el !== switcher && el !== panel && el.id !== 'navigation') panel.append(el);
  }
  const nav = document.querySelector('#navigation');
  sidebar.insertBefore(nav, panel);
  const items = {
    workspace: ['Main breakdown', 'Breakdown', '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>'],
    schedule: ['Shooting schedule', 'Schedule', '<path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>'],
    shots: ['Shot list', 'Shots', '<path d="M3 4h18v16H3zM3 8h18M7 4l3 4M14 4l3 4M9 12h6v4H9z"/>'],
    elements: ['Elements', 'Elements', '<path d="m12 3 9 9-9 9-9-9zM12 8v8M8 12h8"/>'],
    reports: ['Reports', 'Reports', '<path d="M4 21V3M4 21h17M8 17v-6M13 17V7M18 17V4"/>']
  };
  for (const button of nav.querySelectorAll('[data-view]')) {
    const [label, short, path] = items[button.dataset.view];
    button.setAttribute('aria-label', label);
    button.innerHTML = `<span class="desk-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${path}</svg></span><span class="desk-nav-label">${short}</span>`;
  }
  const setOpen = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    sidebar.classList.toggle('tools-open', open);
  };
  toggle.onclick = () => setOpen(panel.hidden);
  panel.addEventListener('click', event => { if (event.target.closest('button')) setOpen(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); }
  });
  nav.addEventListener('click', () => {
    setOpen(false);
    document.activeElement?.blur();
    window.scrollTo({top: 0, behavior: 'instant'});
    requestAnimationFrame(() => window.scrollTo({top: 0, behavior: 'instant'}));
  });
  window.visualViewport?.addEventListener('resize', () => {
    document.body.classList.toggle('desk-keyboard', window.innerHeight - window.visualViewport.height > 120);
  });
}
