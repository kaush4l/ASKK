import { BOOT_WATCHDOG_SCRIPT } from './boot-watchdog.js'

const STYLE = '.askk-boot-notice{display:none}html[data-askk-boot="stalled"] .askk-boot-notice{display:block}.askk-boot-notice,.askk-no-script{position:fixed;inset:12px 12px auto;z-index:2147483647;max-width:640px;margin:auto;padding:16px 20px;border:1px solid #c7a475;border-radius:12px;background:#fff8ec;color:#382610;font:15px/1.5 system-ui,sans-serif;box-shadow:0 4px 24px #0002}.askk-boot-notice p,.askk-no-script p{margin:4px 0 8px}.askk-boot-notice a{display:inline-block;min-height:44px;padding:10px 0;box-sizing:border-box;color:inherit;text-decoration:underline}.askk-boot-notice a:focus-visible{outline:2px solid currentColor;outline-offset:3px}'

/** Remains usable when Next's JavaScript or the application stylesheet never arrives. */
export default function BootDiagnostic() {
  return <>
    <style dangerouslySetInnerHTML={{ __html: STYLE }}/>
    <aside className="askk-boot-notice" role="status" aria-live="polite">
      <strong>ASKK has not finished loading.</strong>
      <p>The application files may be missing, blocked, or still loading. This is separate from an agent or its execution environment starting.</p>
      <a href="./">Reload this page</a>
    </aside>
    <noscript><aside className="askk-no-script"><strong>JavaScript is required to open ASKK.</strong><p>Enable it for this site, then reload the page.</p></aside></noscript>
    <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG_SCRIPT }}/>
  </>
}
