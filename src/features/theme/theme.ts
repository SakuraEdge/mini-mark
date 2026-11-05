const key = 'moye.theme';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let timer: ReturnType<typeof setTimeout> | undefined;

export function initializeTheme() {
  const saved = localStorage.getItem(key);
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme() {
  const root = document.documentElement;
  clearTimeout(timer);
  if (!reducedMotion.matches) {
    root.classList.add('theme-transition');
    // Commit the old colors before changing the palette.
    void root.offsetWidth;
    timer = setTimeout(() => root.classList.remove('theme-transition'), 300);
  } else root.classList.remove('theme-transition');
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(key, root.dataset.theme);
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    clearTimeout(timer);
    document.documentElement.classList.remove('theme-transition');
  }
});
