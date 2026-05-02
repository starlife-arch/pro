(function initThemeFeature() {
  const features = (window.features = window.features || {});
  const enabled = features.themeToggle === true;
  if (!enabled) return;

  const THEME_KEY = 'theme';
  const root = document.documentElement;

  const stored = localStorage.getItem(THEME_KEY);
  const initialTheme = stored === 'dark' ? 'dark' : 'light';
  root.setAttribute('data-theme', initialTheme);

  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.textContent = nextTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
  }

  function mountToggle() {
    if (document.getElementById('theme-toggle')) return;
    const anchor = document.querySelector('.topbar') || document.body;
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.style.marginLeft = '8px';
    btn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.addEventListener('click', () => {
      const active = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(active === 'dark' ? 'light' : 'dark');
    });
    anchor.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle, { once: true });
  } else {
    mountToggle();
  }

  window.themeFeature = { applyTheme };
})();
