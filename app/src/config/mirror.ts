/** Local mirror (run `npm run mirror` in repo root). */
export const MIRROR_ORIGIN =
  import.meta.env.VITE_MIRROR_ORIGIN?.replace(/\/$/, '') || 'http://localhost:5180';

/** Default homepage on the mirrored site. */
export const HOME_PATH =
  import.meta.env.VITE_HOME_PATH || '/de/home.html?n=true&stref=logo';
