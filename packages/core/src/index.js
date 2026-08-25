/**
 * L2 wiring: the seam, the registry fold, the context a module's logic is
 * handed, the log those facts persist into, the driver that runs what a step
 * asked for, and the projections a view reads. No domain logic — this package
 * connects the pure packages to each other and to the ports, and no more.
 * @module
 */

export { createApp, install } from './app.js'
export { Registry } from './registry.js'
export { contextFor } from './ctx.js'
export { handle } from './dispatch.js'
export { ModuleError, LogError } from './errors.js'
export { freshLog, bootLog } from './log/index.js'
export { SEGMENT_SIZE, SNAPSHOT_EVERY, SNAPSHOTS_KEPT, segStream, snapStream, quarantineStream } from './log/index.js'
export { boot, bootFresh } from './boot.js'
export { drive, driving } from './drive.js'
export { runEffect, EFFECT_FAILED } from './effects.js'
export { DEFAULT_DEADLINE_MS } from './deadline.js'
export { CONVERSATION, projections } from './reducers.js'
export { FOLDER, folderReducer, folderNote, named, listed, parent, pathOf, IN_MEMORY } from './folder.js'
export { chat, chatManifest } from './chat.js'
export { files, filesManifest } from './files.js'

/** @typedef {import('./app.js').App} App */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./registry.js').Handler} Handler */
/** @typedef {import('./registry.js').Registered} Registered */
/** @typedef {import('./errors.js').ModuleErrorKind} ModuleErrorKind */
/** @typedef {import('./errors.js').LogErrorKind} LogErrorKind */
/** @typedef {import('./log/index.js').Log} Log */
/** @typedef {import('./log/index.js').Reducer} Reducer */
/** @typedef {import('./log/index.js').Snapshot} Snapshot */
/** @typedef {import('./log/index.js').SegmentStore} SegmentStore */
/** @typedef {import('./log/index.js').Quarantined} Quarantined */
/** @typedef {import('./app.js').Incoming} Incoming */
/** @typedef {import('./app.js').ToolRun} ToolRun */
/** @typedef {import('./boot.js').Assembly} Assembly */
/** @typedef {import('./deadline.js').Driving} Driving */
/** @typedef {import('./reducers.js').Conversation} Conversation */
/** @typedef {import('./reducers.js').Row} Row */
/** @typedef {import('./folder.js').Folder} Folder */
