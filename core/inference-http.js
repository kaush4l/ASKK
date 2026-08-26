/** The two HTTP transports.
 *
 *     OpenAICompatible      /v1/chat/completions or /v1/responses
 *     AnthropicCompatible   /v1/messages
 *
 * Split out of `core/inference.js` — which is the factory and re-exports both —
 * only because one module holding the base, the transports and the catalogue
 * does not fit in 200 lines.
 *
 * PORT-MAP R4: `OpenAICompatible` used the `openai` SDK and `AnthropicCompatible`
 * used `httpx`. Both are plain `fetch` against the same endpoints with the same
 * request bodies now — two fewer dependencies and the same wire. A browser adds
 * one constraint the Python never had: the model server must send CORS headers,
 * or the page cannot reach it at all.
 */

import { Inference, Multimodality } from "./inference-base.js";

/**
 * @typedef {import("./inference-base.js").InferenceOptions} InferenceOptions
 */

/** OpenAI wire protocol. ``api`` picks the endpoint. */
export class OpenAICompatible extends Inference {
  /** @param {InferenceOptions} [options] */
  constructor(options = {}) {
    super(options);
    /** 'completions' = /v1/chat/completions; 'responses' = /v1/responses */
    this.api = options.api ?? "completions";
  }

  /** @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>} */
  async infer(prompt, multimodal) {
    if (this.api === "completions") return await this.completions(prompt, multimodal);
    return await this.responses(prompt, multimodal);
  }

  /** @returns {Record<string, string>} */
  authHeaders() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Plain string when there is nothing attached, else a multipart content list.
   * @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<any>}
   */
  async content(prompt, multimodal) {
    if (!multimodal || multimodal.length === 0) return prompt;
    /** @type {any[]} */
    const parts = [{ type: "text", text: prompt }];
    for (const item of multimodal) {
      for (const url of await item.asDataUrls(this.fs, this.log)) {
        if (item.modalityType === "image") {
          parts.push({ type: "image_url", image_url: { url } });
        } else if (item.modalityType === "audio") {
          const [mime, payload] = Multimodality.splitDataUrl(url);
          parts.push({ type: "input_audio", input_audio: { data: payload, format: mime.split("/").pop() } });
        } else {
          // video — supported by some OpenAI-compatible servers, ignored by others
          parts.push({ type: "video_url", video_url: { url } });
        }
      }
    }
    return parts;
  }

  /** @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>} */
  async completions(prompt, multimodal) {
    const data = await this.post(
      "/chat/completions",
      {
        model: this.model,
        messages: [{ role: "user", content: await this.content(prompt, multimodal) }],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      },
      this.authHeaders(),
    );
    return data?.choices?.[0]?.message?.content || "";
  }

  /** @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>} */
  async responses(prompt, multimodal) {
    /** @type {any} */
    let input = prompt;
    if (multimodal && multimodal.length > 0) {
      /** @type {any[]} */
      const content = [{ type: "input_text", text: prompt }];
      for (const item of multimodal) {
        if (item.modalityType !== "image") continue;
        for (const url of await item.asDataUrls(this.fs, this.log)) {
          content.push({ type: "input_image", image_url: url });
        }
      }
      input = [{ role: "user", content }];
    }
    const data = await this.post(
      "/responses",
      { model: this.model, input, temperature: this.temperature, max_output_tokens: this.maxTokens },
      this.authHeaders(),
    );
    return outputText(data);
  }
}

/**
 * `output_text` was the SDK's convenience, derived from the reply. Over the raw
 * wire some servers send it and some do not, so the blocks are the fallback.
 * @param {any} data @returns {string}
 */
function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  let text = "";
  for (const block of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(block?.content) ? block.content : []) {
      if (part?.type === "output_text") text += part.text ?? "";
    }
  }
  return text;
}

/** Anthropic Messages wire protocol. */
export class AnthropicCompatible extends Inference {
  /** @param {InferenceOptions} [options] */
  constructor(options = {}) {
    super({ ...options, baseUrl: options.baseUrl || "https://api.anthropic.com/v1" });
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
  }

  /** @param {string} prompt @param {Multimodality[]} [multimodal] @returns {Promise<string>} */
  async infer(prompt, multimodal) {
    /** @type {any} */
    let content = prompt;
    if (multimodal && multimodal.length > 0) {
      content = [{ type: "text", text: prompt }];
      for (const item of multimodal) {
        if (item.modalityType !== "image") continue; // Anthropic messages take images only
        for (const url of await item.asDataUrls(this.fs, this.log)) {
          if (!url.startsWith("data:")) {
            content.push({ type: "image", source: { type: "url", url } });
            continue;
          }
          const [mime, payload] = Multimodality.splitDataUrl(url);
          content.push({ type: "image", source: { type: "base64", media_type: mime, data: payload } });
        }
      }
    }
    const data = await this.post(
      "/messages",
      {
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [{ role: "user", content }],
      },
      { "x-api-key": this.apiKey, "anthropic-version": this.anthropicVersion },
    );
    const blocks = Array.isArray(data?.content) ? data.content : [];
    return blocks.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b?.text ?? "").join("");
  }
}
