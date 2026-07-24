// 分層鐵律的自動檢查（CLAUDE.md 第 3 節）：
// 「每一層只能 import 比它低（或同）的層。」低層誤 import 高層 → 這個測試會失敗。
// 例如：core 若哪天 import 了 adapters／render／ui，就會被擋下來。
// 零新依賴——只是把每個檔案的相對 import 抓出來、比對層級高低。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = dirname(fileURLToPath(import.meta.url))

// 層級由低到高（數字越小越低）。core 最低，ui 最高（見 CLAUDE.md 架構圖）。
const LAYER_RANK: Record<string, number> = {
  core: 1,
  adapters: 2,
  render: 3,
  compose: 4,
  share: 5,
  ui: 6,
}

/** 遞迴收集某層資料夾下所有 .ts/.tsx */
function collectFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...collectFiles(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** 抓出一個檔案裡所有相對 import／export...from 的路徑字串 */
function relativeImports(content: string): string[] {
  const out: string[] = []
  const re = /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) out.push(m[1])
  return out
}

describe('分層鐵律（低層不准 import 高層）', () => {
  for (const [layer, rank] of Object.entries(LAYER_RANK)) {
    const dir = join(srcDir, layer)
    for (const file of collectFiles(dir)) {
      const rel = `${layer}/${file.slice(dir.length + 1)}`
      it(rel, () => {
        for (const imp of relativeImports(readFileSync(file, 'utf8'))) {
          // 只在意「跨層」import：'../<某層>' 開頭；'./xxx' 是同層，略過
          const m = imp.match(/^\.\.\/([^/'"]+)/)
          if (!m) continue
          const targetRank = LAYER_RANK[m[1]]
          if (targetRank === undefined) continue // 不是分層資料夾
          expect(
            targetRank,
            `${rel} 不准 import 更高層的 ${m[1]}（${imp}）`,
          ).toBeLessThanOrEqual(rank)
        }
      })
    }
  }
})
