import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import AgentInspector, { RecordedModelInput } from '../src/workbench/AgentInspector.jsx'

test('recorded model input exposes separate native definitions without implying execution', () => {
  const prompt = { messages: [{ role: 'user', content: 'Read the file' }], nativeTools: [{ type: 'function', function: { name: 'historical_read', description: 'Recorded read definition' } }], responseProtocol: 'native' }
  const html = renderToStaticMarkup(<RecordedModelInput prompt={prompt}/>)
  for (const value of ['Read the file', 'historical_read', 'Recorded read definition', 'separately from messages', 'not evidence of tool execution', 'current settings may differ', 'latest recorded compiled input', 'does not establish that a provider request was transmitted', 'transmission and retry records']) expect(html).toContain(value)
  expect(renderToStaticMarkup(<RecordedModelInput prompt={{ messages: [], nativeTools: [] }}/>)).toContain('separately from messages')
  expect(renderToStaticMarkup(<RecordedModelInput prompt={{ messages: [] }}/>)).not.toContain('Native function definitions')
})

test('agent inspector names the recorded model input and handles absent historical evidence', () => {
  expect(renderToStaticMarkup(<AgentInspector details={{ name: 'Example' }}/>)).toContain('Recorded model input')
  const html = renderToStaticMarkup(<RecordedModelInput/>)
  expect(html).toContain('No compiled model input has been recorded')
  expect(html).not.toContain('in this session')
  expect(html).not.toContain('Native function definitions')
})
