import { restoreAgentPackage, PACKAGE_LOCK } from '../core/agent-package.js'

/** Copy the complete verified folder, not a reconstructed prompt or tool grant. */
export async function copyAgentSource(hub, path) {
  if (hub.disposed) throw new Error('The agent desk has stopped.')
  const spec = hub.specs?.get(path)
  const identity = spec?.package
  if (!identity) throw new Error('This agent has no portable source folder.')
  const data = identity.namespace === 'installed'
    ? hub.packages.items.get(identity.installationId)?.record?.data
    : identity.namespace === 'bundled'
      ? hub.shippedPackageSources?.find(row => row.id === identity.installationId)?.data
      : null
  if (!data || data.revisionDigest !== identity.revisionDigest) throw new Error('The source folder does not match this agent revision. Reload its definition and try again.')
  const pkg = await restoreAgentPackage(data)
  const files = []
  for (const file of await pkg.source.list()) {
    if (file.path === PACKAGE_LOCK) continue
    let content
    try { content = await pkg.source.read(file.path) }
    catch (error) { throw new Error(`Cannot copy ${file.path} into the text editor: ${error.message}. The original folder was preserved.`) }
    files.push({ path: file.path, content })
  }
  if (hub.disposed || hub.specs.get(path) !== spec) throw new Error('The agent definition changed while copying. Open its current definition and try again.')
  return { label: `${spec.name || identity.packageId} copy`.slice(0, 200), files }
}
