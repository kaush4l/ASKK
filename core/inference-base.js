/** The values inference is made of, and the abstract base itself.
 *
 *     Message           one conversation turn
 *     Multimodality     the non-text data that rides along with a prompt
 *     Inference         .infer(prompt, multimodal) -> string
 *
 * This is the lower half of the Python's `core/inference.py`. It is a separate
 * file only because that one module does not fit in 200 lines once the
 * transports and the catalogue are written out; `core/inference.js` is the
 * upper half and re-exports everything here, so callers still import one name.
 * The split is also what keeps R5 honest: `core/inference-cli.js` extends this
 * base without importing the catalogue that would have to register it.
 */

/**
 * @typedef {import("./ports.js").FsPort} FsPort
 * @typedef {import("./ports.js").FetchPort} FetchPort
 * @typedef {{ warn?: (m: string) => void, error?: (m: string) => void }} Log
 * @typedef {Record<string, unknown>} Settings
 */

/** A pure core does not own a logger: one is handed in, and silence is the default. */
/** @type {Log} */
const NO_LOG = {};

/** @param {string} text @returns {string} */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** What `mimetypes.guess_type` would answer for the extensions this can hold. */
/** @type {Record<string, string>} */
const MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", wav: "audio/wav", mp3: "audio/mpeg",
  ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
};

/** One conversation turn. */
export class Message {
  /** @param {{ role: "system"|"user"|"assistant", content: string }} fields */
  constructor({ role, content }) {
    this.role = role;
    this.content = content;
  }

  /** @returns {{ role: string, content: string }} */
  asDict() {
    return { role: this.role, content: this.content };
  }
}

/**
 * Non-text data sent alongside the prompt.
 *
 * ``collection`` holds data URLs (``data:image/png;base64,...``), http(s) URLs,
 * or workspace paths — paths are read and encoded at send time.
 */
export class Multimodality {
  /** @type {Record<string, string>} */
  static MIME_DEFAULTS = { image: "image/png", audio: "audio/wav", video: "video/mp4" };

  /** @param {{ modalityType: "image"|"audio"|"video", collection?: string[] }} fields */
  constructor({ modalityType, collection = [] }) {
    this.modalityType = modalityType;
    this.collection = collection;
  }

  /** Infer the modality from a data URL's mime type. @param {unknown} value */
  static of(value) {
    if (typeof value !== "string" || !value.startsWith("data:")) return null;
    const kind = value.slice(5).split(";", 1)[0].split("/", 1)[0];
    return kind === "image" || kind === "audio" || kind === "video"
      ? new Multimodality({ modalityType: kind, collection: [value] })
      : null;
  }

  /**
   * Every item as a data URL or remote URL, dropping anything unreadable.
   * @param {FsPort} [fs] @param {Log} [log] @returns {Promise<string[]>}
   */
  async asDataUrls(fs, log = NO_LOG) {
    /** @type {string[]} */
    const urls = [];
    for (const item of this.collection) {
      if (typeof item !== "string" || !item) continue;
      if (/^(data:|https?:\/\/)/.test(item)) urls.push(item);
      else {
        const encoded = await this.encodeFile(item, fs, log);
        if (encoded) urls.push(encoded);
      }
    }
    return urls;
  }

  /**
   * A file that cannot be read is skipped with a warning, never a throw: one
   * missing attachment must not cost the turn the prompt was for.
   * @param {string} path @param {FsPort} [fs] @param {Log} [log]
   */
  async encodeFile(path, fs, log = NO_LOG) {
    /** @type {string | null} */
    let data = null;
    try {
      data = fs ? await fs.read(path) : null;
      if (data === null) throw new Error("not in the workspace");
    } catch (error) {
      log.warn?.(`Skipping unreadable ${this.modalityType} file ${path}: ${error}`);
      return null;
    }
    const ext = (path.split("/").pop() ?? "").split(".").slice(1).pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext] ?? Multimodality.MIME_DEFAULTS[this.modalityType];
    return `data:${mime};base64,${base64(data)}`;
  }

  /**
   * ``data:image/png;base64,AAA`` -> ``["image/png", "AAA"]``.
   * @param {string} url @returns {[string, string]}
   */
  static splitDataUrl(url) {
    const cut = url.indexOf(",");
    const header = cut === -1 ? url : url.slice(0, cut);
    return [header.slice(5).split(";", 1)[0], cut === -1 ? "" : url.slice(cut + 1)];
  }
}

/**
 * @typedef {object} InferenceOptions
 * @property {string} [model] @property {string} [baseUrl] @property {string} [apiKey]
 * @property {number} [temperature] @property {number} [maxTokens] @property {number} [timeout]
 * @property {"responses"|"completions"} [api] @property {string} [anthropicVersion]
 * @property {FetchPort} [fetch] @property {FsPort} [fs] @property {Log} [log]
 */

/** Abstract inference client. Subclasses implement one wire protocol. */
export class Inference {
  /** @param {InferenceOptions} [options] */
  constructor(options = {}) {
    this.model = options.model ?? "";
    this.baseUrl = options.baseUrl ?? "";
    this.apiKey = options.apiKey ?? "";
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 131072; // 128k
    this.timeout = options.timeout ?? 300.0;
    /** @type {FetchPort | undefined} */ this.fetchPort = options.fetch;
    /** @type {FsPort | undefined} */ this.fs = options.fs;
    /** @type {Log} */ this.log = options.log ?? NO_LOG;
  }

  /**
   * Send one prompt string plus any attachments, return the model's text reply.
   *
   * Conversation history is the caller's job — see ``Agent.render``.
   *
   * @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>}
   */
  async infer(prompt, multimodal) {
    void prompt, multimodal;
    throw new Error(`${this.constructor.name} does not implement infer`);
  }

  /** Release the transport. Override where there is one to close. */
  async close() {}

  /**
   * One POST, with the timeout honoured and the server's own words kept on a
   * failure: a model server's error text is the most useful thing at that
   * moment, so the status and the first 500 characters of the body both travel.
   * @param {string} path @param {unknown} body @param {Record<string,string>} headers
   * @returns {Promise<any>}
   */
  async post(path, body, headers) {
    const send = this.fetchPort;
    if (!send) throw new Error("no fetch port configured");
    const response = await send(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout * 1000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`${this.baseUrl}${path} returned ${response.status}: ${detail || "no body"}`);
    }
    return await response.json();
  }
}
