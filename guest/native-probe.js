/** Run inside the ARM64 image before converting it to Wasm. No host source is modified. */
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
const root = '/tmp/askk-native-probe'
fs.mkdirSync(`${root}/pages`, { recursive: true })
fs.writeFileSync(`${root}/package.json`, JSON.stringify({ private: true, scripts: { build: 'next build --webpack' }, dependencies: { next: '16.3.6', react: '19.3.0', 'react-dom': '19.3.0' } }))
fs.writeFileSync(`${root}/next.config.mjs`, 'export default {output:"export",images:{unoptimized:true},experimental:{cpus:1}}')
fs.writeFileSync(`${root}/pages/index.js`, 'import React from "react";export default function Page(){return React.createElement("main",null,"Browser Linux native build proof")}')
const install = spawnSync('npm', ['install', '--offline', '--no-audit', '--no-fund'], { cwd: root, encoding: 'utf8', timeout: 180000 })
process.stdout.write(install.stdout ?? '')
process.stderr.write(install.stderr ?? '')
if (install.status !== 0) process.exit(1)
const result = spawnSync('npm', ['run', 'build'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', timeout: 180000 })
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.status !== 0 || !fs.readFileSync(`${root}/out/index.html`, 'utf8').includes('Browser Linux native build proof')) process.exit(1)
console.log(JSON.stringify({ nativeNextStaticExport: true, node: process.version, architecture: process.arch, bytes: fs.statSync(`${root}/out/index.html`).size }))
