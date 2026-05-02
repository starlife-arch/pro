(function initThemeFeature() {
  const features = (window.features = window.features || {});
  console.log('Theme Loaded');

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
    const host = document.getElementById('theme-toggle-host') || document.body;
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.type = 'button';
    btn.className = 'btn btn-sm';
    btn.textContent = initialTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.addEventListener('click', () => {
      const active = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(active === 'dark' ? 'light' : 'dark');
    });
    host.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle, { once: true });
  } else {
    mountToggle();
  }

  window.themeFeature = { applyTheme, enabled: features.themeToggle !== false };
})();
