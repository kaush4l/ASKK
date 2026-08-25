/**
 * The model card every state that makes a call needs. A card and not a default,
 * because the budget is derived from a window and a window nobody stated is a
 * number somebody invented (`docs/RULINGS.md` Attack 4).
 * @type {import('@harness/context').ModelCard}
 */
export const CARD = {
  name: 'local',
  model: 'test-model',
  kind: 'openai',
  contextTokens: 16384,
  maxOutputTokens: null,
  acceptsImages: false,
  reasons: false,
}
