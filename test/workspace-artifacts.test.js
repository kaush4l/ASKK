import { test, expect } from 'bun:test'
import { packageArtifact, validateAssertions } from '../src/workspace/artifacts.js'
const file = (path, content) => ({ path, content })

test('artifact package includes local scripts, CSS and assets in opaque-compatible HTML', async () => {
  const artifact = await packageArtifact({ revision: 'build-1', files: [file('index.html', '<html><head><link rel="stylesheet" href="/style.css"><script defer src="/app.js"></script></head><body><img src="/logo.svg"></body></html>'), file('style.css', 'body{background:url("logo.svg")}'), file('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'), file('app.js', 'document.body.dataset.loaded="yes"')] }, { revision: 7, runtime: 'browser-linux:test' })
  expect(artifact.revision).toBe(7)
  expect(artifact.buildId).toBe('build-1')
  expect(artifact.html).toContain('document.body.dataset.loaded')
  expect(artifact.html).toContain('data:image/svg+xml;base64,')
  expect(artifact.html).toContain("connect-src 'none'")
  expect(artifact.html).not.toContain('src="/app.js"')
  expect(artifact.resources).toEqual(['style.css', 'logo.svg', 'app.js'])
  URL.revokeObjectURL(artifact.url)
})

test('artifact package rejects missing resources and unbounded external resources', async () => {
  await expect(packageArtifact({ files: [file('index.html', '<script src="/missing.js"></script>')] })).rejects.toThrow('Missing artifact resource')
  await expect(packageArtifact({ files: [file('index.html', '<script src="https://example.com/app.js"></script>')] })).rejects.toThrow('External artifact resource')
  await expect(packageArtifact({ files: [file('index.html', '<iframe src="/other"></iframe>')] })).rejects.toThrow('Nested frames')
  await expect(packageArtifact({ files: [file('index.html', '<img srcset="/a.png 1x">')] })).rejects.toThrow('srcset')
})

test('check plans cannot claim an interaction result without an outcome afterwards', () => {
  expect(() => validateAssertions([{ action: 'click', selector: 'button' }])).toThrow('followed by')
  expect(() => validateAssertions([{ action: 'assertCount', selector: 'li', count: 1 }, { action: 'click', selector: 'button' }])).toThrow('followed by')
  expect(() => validateAssertions([{ action: 'click', selector: 'button' }, { action: 'assertText', selector: '#result', value: '' }])).toThrow('concrete text')
  expect(() => validateAssertions([{ action: 'assertCount', selector: 'li', count: '1' }])).toThrow('integer')
  expect(() => validateAssertions(Array.from({ length: 101 }, () => ({ action: 'click', selector: 'button' })))).toThrow('between 1 and 100')
  const plan = validateAssertions([{ action: 'fill', selector: 'input', value: 'Buy milk' }, { action: 'click', selector: 'button' }, { action: 'assertText', selector: 'li', value: 'Buy milk' }])
  expect(Object.isFrozen(plan)).toBe(true)
  expect(Object.isFrozen(plan[0])).toBe(true)
})
