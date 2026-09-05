/** Match Kumo's explicit mode to the OS before rendering, including portalled controls. */
export function syncSystemAppearance(): () => void {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { document.documentElement.dataset.mode = preference.matches ? 'dark' : 'light'; };
  apply();
  preference.addEventListener('change', apply);
  return () => preference.removeEventListener('change', apply);
}
