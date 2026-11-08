// World state in runes. A twin replaces one object by id at any depth; "world" replaces all.
import * as api from "./api.js";
import { replaceTwin, findObject } from "./logic/world.js";
import { rememberSize } from "./logic/sizes.js";
import fixture from "./fixtures/world.json";

const clone = (x) => JSON.parse(JSON.stringify(x));

class Store {
  world = $state(null);
  /** connecting | live | reconnecting | fixture */
  status = $state("connecting");
  error = $state("");
  locked = $state(true);
  sheet = $state(null); // id whose full view is open
  /** the card expanded INTO the content area: {id, mode: "expand", from: rect} (logic/focus.js) or null */
  focus = $state(null);
  #stop = null;

  get fixture() { return this.status === "fixture"; }
  find(id) { return findObject(this.world, id); }

  setWorld(w) { if (w) this.world = w; }
  patch(id, twin) { if (this.world && twin) replaceTwin(this.world, id, twin); }

  async start() {
    try {
      this.setWorld(await api.world());
      this.status = "live";
      this.#stop = api.events({
        open: async (reconnected) => {
          if (reconnected) { const w = await api.world().catch(() => null); if (w) this.setWorld(w); }
          this.status = "live";
        },
        error: () => { this.status = "reconnecting"; },
        twin: (id, twin) => this.patch(id, twin),
        world: async (w) => { this.setWorld(w?.engines ? w : await api.world().catch(() => null)); },
      });
    } catch {
      this.world = clone(fixture);
      this.status = "fixture";
    }
  }
  stop() { this.#stop?.(); }

  async act(target, action, args) {
    this.error = "";
    if (this.fixture) { this.error = `offline (fixture): ${action} not sent`; return; }
    try { const { twin } = await api.act(target, action, args); if (twin) this.patch(target, twin); }
    catch (e) { this.error = `${action}: ${e.message}`; }
  }
  /** An action whose result is data, not a twin (e.g. desk model.discover): returns it, or null with store.error set. */
  async ask(target, action, args) {
    this.error = "";
    if (this.fixture) { this.error = `offline (fixture): ${action} not sent`; return null; }
    try { const { twin } = await api.act(target, action, args); return twin ?? null; }
    catch (e) { this.error = `${action}: ${e.message}`; return null; }
  }
  async saveLayout(view, layout) {
    if (this.world) this.world.layouts = { ...this.world.layouts, [view]: layout };
    if (this.fixture) return;
    try { await api.saveLayout(view, layout); } catch (e) { this.error = `layout: ${e.message}`; }
  }
  /** The owner stepped a card: remembered per object in the view's layout (a step back to auto forgets it). */
  setSize(view, id, size, auto) {
    const layout = this.world?.layouts?.[view] ?? {};
    return this.saveLayout(view, { ...layout, sizes: rememberSize(layout.sizes, id, size, auto) });
  }
  async saveUi(view, tree) {
    if (this.world) this.world.ui = { ...(this.world.ui ?? {}), [view]: tree };
    if (this.fixture) { this.error = "offline (fixture): page kept in this tab only"; return; }
    try { await api.saveUi(view, tree); } catch (e) { this.error = `page: ${e.message}`; }
  }
  async uploadAsset(file) {
    if (this.fixture) { this.error = "offline (fixture): no upload"; return null; }
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = no; r.readAsDataURL(file); });
    try { return (await api.uploadAsset(file.name, data)).url; } catch (e) { this.error = `upload: ${e.message}`; return null; }
  }
  async saveTheme(tokens) {
    if (this.world) this.world.theme = tokens; // theme is the tokens themselves (contract Backend notes 1)
    if (this.fixture) { this.error = "offline (fixture): theme kept in this tab only"; return; }
    try { await api.saveTheme(tokens); } catch (e) { this.error = `theme: ${e.message}`; }
  }
}

export const store = new Store();
