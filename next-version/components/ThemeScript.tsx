/**
 * Paints the stored theme before the first frame.
 *
 * The account preference lives on the server, but reading it costs a round
 * trip, so it is mirrored into localStorage. Applying that mirror from an
 * effect is too late: the browser has already painted using the OS setting,
 * and a user who chose Light on a dark machine watches the page flash dark
 * and correct itself on every navigation that reloads the document.
 *
 * A blocking inline script in <head> runs before any paint. It is deliberately
 * tiny and swallows everything — a theme is not worth failing a page load for,
 * and unreadable storage is indistinguishable from "no preference set".
 */
const SCRIPT = `(function(){try{var t=localStorage.getItem("themePreference");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
