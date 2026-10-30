// 물리 테스트 실행: TS 를 esbuild 로 묶어서 node 로 돌린다
import { build } from 'esbuild'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 프로젝트 안에 둬야 node_modules 를 찾는다
const dir = resolve('node_modules/.cache/wh-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'test.mjs')
try {
  await build({
    entryPoints: ['test/world.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    alias: { '@shared': resolve('src/shared') },
    external: ['@dimforge/*', 'electron', 'koffi'],
    logLevel: 'error'
  })
  await import(pathToFileURL(out).href)
} finally {
  rmSync(out, { force: true })
}
