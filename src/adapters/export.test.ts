// 匯出功能的測試（不碰 DOM 的部分）。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import { documentToJson, embedCode } from './export'

const here = dirname(fileURLToPath(import.meta.url))

describe('documentToJson', () => {
  it('匯出的 JSON 可以原樣讀回來（round-trip）', () => {
    const raw = readFileSync(resolve(here, '../../examples/marriage-equality.hst.json'), 'utf-8')
    const doc = JSON.parse(raw) as TimelineDocument
    const out = documentToJson(doc)
    expect(JSON.parse(out)).toEqual(JSON.parse(raw))
  })

  it('程式不認識的欄位也會原樣寫回（SPEC 第 10 節向前相容）', () => {
    const doc = {
      hackstory: '0.1',
      id: 'x',
      meta: { title: 't' },
      tracks: [{ id: 'a', title: 'a' }],
      events: [],
      futureFeature: { fancy: true }, // 未來版本的欄位
    } as unknown as TimelineDocument
    const out = JSON.parse(documentToJson(doc)) as Record<string, unknown>
    expect(out.futureFeature).toEqual({ fancy: true })
  })
})

describe('embedCode', () => {
  it('產生含網址的 iframe 標籤', () => {
    const code = embedCode('https://example.com/hackstory/?embed=1')
    expect(code).toContain('<iframe')
    expect(code).toContain('https://example.com/hackstory/?embed=1')
    expect(code).toContain('title="HackStory 時間軸"')
  })
})
