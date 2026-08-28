'use client';

/**
 * Wave-1 scaffold. The only thing this page owes anyone is one string a check
 * can read out of the DOM of the built, subpath-served export — which is how
 * every later increment proves the page is a page and not a blank document
 * that happened to return 200.
 */
export const PAGE_MARK = 'ASKK_PAGE_ALIVE';

export default function Page() {
  return (
    <main data-page-mark={PAGE_MARK}>
      <h1>ASKK</h1>
      <p>{PAGE_MARK}</p>
    </main>
  );
}
