import distribution from '../../public/companion-release.json'

/** Distribution metadata owns supported targets; rendering never starts a host process. */
export default function CompanionSetup({ pageOrigin = '' }) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
  return <details className="model-setup-help">
    <summary>Download companion and set up HTTPS</summary>
    <p className="form-help">Bun and the bridge tools are bundled. No ASKK checkout or separate Bun installation is needed. These unsigned developer previews require manual launch and an already trusted loopback certificate.</p>
    {distribution.releases.map(release => <div key={release.id}>
      <a className="button subtle small" href={`${base}/${release.file}`} download>Download for {release.label} · {(release.bytes / 1048576).toFixed(1)} MiB</a>
      <p className="form-help">{release.runtime} · {release.signed ? 'Signed' : 'Unsigned'} · {release.status.replaceAll('-', ' ')}</p>
      <details><summary>Archive SHA-256</summary><pre style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{release.sha256}</pre></details>
      <a href={release.instructions} target="_blank" rel="noreferrer">Package setup and supported tools ↗</a>
    </div>)}
    <p className="form-help">The available package targets Apple Silicon Macs. Other desktop systems need a separate tested package. On iPhone, use a reachable HTTPS provider; 127.0.0.1 refers to the phone.</p>
    <ol>
      <li>Extract the archive and open a terminal in the extracted folder. Keep its files together.</li>
      <li>Prepare a certificate for 127.0.0.1 through your trusted local development setup. This page cannot install or trust certificates.</li>
      <li>Replace the project, certificate and key paths below. An empty project directory works for model-only use. Set the exact model API base and page origin.</li>
      <li>Copy the token from the private pairing JSON into the field below. Never paste it into an agent conversation.</li>
    </ol>
    <pre>{String.raw`mkdir -p "$HOME/.askk/private"
chmod 700 "$HOME/.askk/private"
./askk-companion --root /absolute/project \
  --capabilities model-relay \
  --model-endpoint http://127.0.0.1:8873/v1 \
  --tls-cert /absolute/private/loopback-cert.pem \
  --tls-key /absolute/private/loopback-key.pem \
  --pairing-file "$HOME/.askk/private/askk-pairing.json" \
  --allow-origin ${pageOrigin || 'https://kaush4l.github.io'}`}</pre>
    <p className="form-help">Only model inference routes at the configured API base are granted. Files, commands, terminals and general network access remain ungranted. Browser trust remains unconfirmed until this browser can pair. Do not bypass certificate warnings. An automatic trust installer is not included.</p>
  </details>
}
