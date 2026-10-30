// 맥 빌드 결과 검사: 서명 · 인증서 체인 · 하드닝 런타임 · 공증 · 스테이플
// 사용법: node scripts/verify-mac.mjs   (build-mac.mjs 가 공증 빌드 뒤에 부른다)
// 하나라도 어긋나면 실패로 끝난다 → 잘못된 파일이 릴리스에 올라가지 않게.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TEAM = 'GQJXPJX34S'
const CHAIN = [`Developer ID Application: KWANGJO KIM (${TEAM})`, 'Developer ID Certification Authority', 'Apple Root CA']
const app = ['dist/mac-universal/WormholeMonitor.app', 'dist/mac/WormholeMonitor.app'].find(existsSync)
const dmg = 'dist/WormholeMonitor-mac.dmg'

let failed = 0
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

if (!app) throw new Error('dist/ 에 WormholeMonitor.app 이 없어요. 먼저 빌드해 주세요.')
console.log(`\n검사: ${app}${existsSync(dmg) ? ` · ${dmg}` : ''}`)

const strict = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
check('서명 검증 (deep · strict)', strict.ok, strict.ok ? '' : strict.out.trim())

const info = run('codesign', ['-dvvv', app]).out
const authority = [...info.matchAll(/^Authority=(.*)$/gm)].map((m) => m[1])
check('인증서 체인 3단계', JSON.stringify(authority) === JSON.stringify(CHAIN), authority.join(' → '))
check('팀 ID', info.includes(`TeamIdentifier=${TEAM}`))
check('보안 타임스탬프', /^Timestamp=/m.test(info))
check('하드닝 런타임', /flags=0x[0-9a-f]*\(runtime\)/.test(info) || /Runtime Version=/.test(info))

// 서명 인증서를 꺼내서 발급자가 G2 인지 (체인 이름만으로는 G1/G2 를 구분할 수 없다)
const tmp = mkdtempSync(join(tmpdir(), 'wh-verify-'))
try {
  run('codesign', ['-d', `--extract-certificates=${join(tmp, 'c')}`, app])
  const issuer = run('openssl', ['x509', '-inform', 'der', '-in', join(tmp, 'c0'), '-noout', '-issuer', '-enddate']).out
  check('서명 인증서 발급자 = G2', /OU\s*=\s*G2/.test(issuer), issuer.replace(/\n/g, ' ').trim())
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const gk = run('spctl', ['-a', '-t', 'exec', '-vvv', app])
check('Gatekeeper (앱)', gk.ok && gk.out.includes('source=Notarized Developer ID'), gk.out.split('\n').find((l) => l.includes('source=')) ?? gk.out.trim())
check('스테이플 (앱)', run('xcrun', ['stapler', 'validate', app]).ok)

if (existsSync(dmg)) {
  const gd = run('spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vvv', dmg])
  check('Gatekeeper (dmg)', gd.ok && gd.out.includes('Notarized Developer ID'), gd.out.split('\n').find((l) => l.includes('source=')) ?? gd.out.trim())
  check('스테이플 (dmg)', run('xcrun', ['stapler', 'validate', dmg]).ok)
}

if (failed) {
  console.error(`\n✗ ${failed}개 항목 실패`)
  process.exit(1)
}
console.log('\n✓ 서명 · 체인 · 공증 모두 정상')
