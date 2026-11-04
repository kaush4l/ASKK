import { describe, expect, test } from "bun:test";
import {
  artifactElement,
  earlierRunsElement,
  instructionsElement,
  ownerGuidanceElement,
  renderPrompt,
  requestElement,
  responseElement,
  soulElement,
  toolsElement,
  workDoneElement,
} from "./elements.js";
import { DEFAULT_TEMPLATE_ORDER, defaultTemplate } from "./template-order.js";

function fullMap() {
  return {
    soul: soulElement("Soul."),
    instructions: instructionsElement("YOU ARE."),
    tools: toolsElement([]),
    artifact: artifactElement(null),
    request: requestElement("Do the thing."),
    "owner-guidance": ownerGuidanceElement("Steer left."),
    "earlier-runs": earlierRunsElement(["ran once"]),
    "work-done": workDoneElement(["did x"]),
    response: responseElement("TOON"),
  };
}

describe("template order: insertion order IS render order", () => {
  test("default order is the old order", () => {
    expect(DEFAULT_TEMPLATE_ORDER).toEqual([
      "soul",
      "instructions",
      "tools",
      "artifact",
      "request",
      "owner-guidance",
      "earlier-runs",
      "work-done",
      "response",
    ]);
    const rendered = defaultTemplate(fullMap()).render();
    const ids = [
      "Soul.",
      "YOU ARE.",
      "No tools.",
      "Live artifact: default",
      "Do the thing.",
      "Steer left.",
      "ran once",
      "did x",
      "TOON",
    ];
    let last = -1;
    for (const text of ids) {
      const at = rendered.indexOf(text);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  test("inserting a new element changes render order accordingly", () => {
    const template = defaultTemplate(fullMap());
    template.insert(requestElement("Second request."));
    const rendered = template.render();
    expect(rendered.endsWith("Second request.")).toBe(true);
    template.insertAt(soulElement("Inserted first."), 0);
    expect(template.render().startsWith("Inserted first.")).toBe(true);
  });

  test("removing and moving an element changes order, no hardcoded revert", () => {
    const template = defaultTemplate(fullMap());
    template.remove("tools");
    expect(template.order()).not.toContain("tools");
    expect(template.render()).not.toContain("No tools.");
    template.move("response", 0);
    expect(template.order()[0]).toBe("response");
    expect(template.render().startsWith("TOON")).toBe(true);
    // Re-rendering does not snap back to the default order.
    expect(template.render().startsWith("TOON")).toBe(true);
  });

  test("renderPrompt delegates to the ordered template: input order wins", () => {
    const a = renderPrompt([soulElement("Soul."), toolsElement([])]);
    const b = renderPrompt([toolsElement([]), soulElement("Soul.")]);
    expect(a).toBe("Soul.\n\nNo tools.");
    expect(b).toBe("No tools.\n\nSoul.");
    expect(a).not.toBe(b);
  });

  test("defaultTemplate inserts only present elements, never invented ones", () => {
    const template = defaultTemplate({ soul: soulElement("Only soul.") });
    expect(template.order()).toEqual(["soul"]);
    expect(template.render()).toBe("Only soul.");
  });
});
