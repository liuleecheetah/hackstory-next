// CSV 匯入器的測試。
// 直接讀 examples/dirty-sample.csv——那份檔案故意保留所有壞資料
// （重複列、欄位錯位、無效日期），規格好不好就用它來檢驗。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateDocument } from '../core'
import { draftsToDocument, parseCsvText, retryRow } from './csv'
import { filenameFromContentDisposition, toCsvUrl } from './gsheet'

const here = dirname(fileURLToPath(import.meta.url))
const dirtyCsv = readFileSync(resolve(here, '../../examples/dirty-sample.csv'), 'utf-8')

describe('dirty-sample.csv 整檔分流', () => {
  const outcome = parseCsvText(dirtyCsv)

  it('解析成功，且中文表頭全部認得', () => {
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    const mapped = outcome.headers.map((h) => h.mapped)
    expect(mapped).toEqual([
      'start', 'time', 'end', 'title', 'description', 'location', 'tags', 'sources',
    ])
  })

  it('成功 10 筆、警告 3 筆、無法解析 2 筆（整列空白的那列不算數）', () => {
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.triage.events.length).toBe(10)
    expect(outcome.triage.warnings.length).toBe(3)
    expect(outcome.triage.unresolved.length).toBe(2)
  })

  it('「2010年6月」保留月精度；「09:00-18:00」拆成起訖；來源網址存成 url', () => {
    if (!outcome.ok) throw new Error('unreachable')
    const events = outcome.triage.events
    const fuzzy = events.find((e) => e.title === '油品檢驗爭議浮現')
    expect(fuzzy?.start).toMatchObject({ value: '2010-06', precision: 'month' })
    const hearing = events.find((e) => e.title.includes('公聽會'))
    expect(hearing?.start.value).toBe('2016-11-24T09:00')
    expect(hearing?.end?.value).toBe('2016-11-24T18:00')
    const ruling = events.find((e) => e.title.includes('748'))
    expect(ruling?.sources?.[0]?.url).toContain('judicial.gov.tw')
  })

  it('三筆重複的「民法修正案出委員會」全數保留，後兩筆標記疑似重複', () => {
    if (!outcome.ok) throw new Error('unreachable')
    const dups = outcome.triage.events.filter((e) => e.title === '民法修正案出委員會')
    expect(dups.length).toBe(3)
    expect(dups.filter((e) => e.suspectedDuplicateOf).length).toBe(2)
  })

  it('「你好天」與欄位錯位列進待修正清單，原樣保留', () => {
    if (!outcome.ok) throw new Error('unreachable')
    const reasons = outcome.triage.unresolved.map((u) => u.reason).join('\n')
    expect(reasons).toContain('你好天')
    expect(outcome.triage.unresolved.some((u) => u.row.start === '台北市')).toBe(true)
  })
})

describe('表頭往下搜尋與主題標題', () => {
  it('第一列是主題標題時，往下找到真正的表頭列，主題變成建議的圖層標題', () => {
    const csv = '同婚大事記\n\n日期,標題\n2017/5/24,釋字748公布\n'
    const outcome = parseCsvText(csv)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.titleHint).toBe('同婚大事記')
    expect(outcome.triage.events.length).toBe(1)
    expect(outcome.triage.events[0].title).toBe('釋字748公布')
  })

  it('表頭就在第一列時，titleHint 為空、行為不變', () => {
    const outcome = parseCsvText('日期,標題\n2017/5/24,某事件\n')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.titleHint).toBeUndefined()
  })

  it('前 10 列都認不出表頭 → 明確報錯，附上第一列內容', () => {
    const outcome = parseCsvText('隨便,亂寫\n甲,乙\n')
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error).toContain('隨便')
  })
})

describe('試算表名稱（Content-Disposition）', () => {
  it('優先讀 UTF-8 編碼的檔名（中文名稱在這裡）', () => {
    expect(
      filenameFromContentDisposition(
        `attachment; filename="HackStory_Sample.csv"; filename*=UTF-8''%E5%A4%A7%E4%BA%8B%E8%A8%98.csv`,
      ),
    ).toBe('大事記')
  })

  it('沒有 UTF-8 版本就用一般檔名，去掉 .csv 副檔名', () => {
    expect(filenameFromContentDisposition('attachment; filename="My Sheet.csv"')).toBe('My Sheet')
  })

  it('沒有標頭 → null', () => {
    expect(filenameFromContentDisposition(null)).toBeNull()
  })
})

describe('template.csv 範本（說明文件提供給使用者的起手檔）', () => {
  it('整份範本乾淨匯入：主題列變標題、6 筆全過、分成主線支線兩軸', () => {
    const outcome = parseCsvText(
      readFileSync(resolve(here, '../../examples/template.csv'), 'utf-8'),
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.titleHint).toContain('我的時間軸主題')
    expect(outcome.triage.events.length).toBe(6)
    expect(outcome.triage.unresolved).toEqual([])
    const doc = draftsToDocument(outcome.triage.events, { title: '範本', sourceType: 'csv' })
    expect(doc.tracks.map((t) => t.title)).toEqual(['主線', '支線'])
    expect(validateDocument(doc).ok).toBe(true)
  })
})

describe('逐筆修正（retryRow）', () => {
  it('使用者把「你好天」改成正常日期後，重試成功', () => {
    const fixed = retryRow({ start: '2014/5/1', title: '不知道哪天發生的事' })
    expect(fixed.ok).toBe(true)
    if (!fixed.ok) throw new Error('unreachable')
    expect(fixed.draft.start.value).toBe('2014-05-01')
  })

  it('改完還是壞的 → 回傳中文原因，不會硬吞', () => {
    const stillBad = retryRow({ start: '大概是夏天', title: '不知道哪天發生的事' })
    expect(stillBad.ok).toBe(false)
  })
})

describe('組成文件（draftsToDocument）', () => {
  it('分流結果組成的文件通過 SPEC 驗證', () => {
    const outcome = parseCsvText(dirtyCsv)
    if (!outcome.ok) throw new Error('unreachable')
    const doc = draftsToDocument(outcome.triage.events, {
      title: '髒資料測試',
      sourceType: 'csv',
    })
    const result = validateDocument(doc)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(doc.tracks.length).toBe(1) // 沒有分類欄 → 單一「匯入資料」軸
    expect(doc.events.length).toBe(10)
  })

  it('有「分類」欄時，依值分成多條軸線', () => {
    const outcome = parseCsvText('日期,標題,分類\n2017/1/1,甲事件,立法\n2017/2/1,乙事件,運動\n2017/3/1,丙事件,立法\n')
    if (!outcome.ok) throw new Error('unreachable')
    const doc = draftsToDocument(outcome.triage.events, { title: '多軸測試', sourceType: 'csv' })
    expect(doc.tracks.map((t) => t.title)).toEqual(['立法', '運動'])
    expect(validateDocument(doc).ok).toBe(true)
  })
})

describe('Google Sheet 網址轉換（toCsvUrl）', () => {
  it('「發布到網路」連結補上 output=csv', () => {
    expect(toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub')).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv',
    )
  })

  it('一般網址轉成 export CSV，保留分頁 gid', () => {
    expect(
      toCsvUrl('https://docs.google.com/spreadsheets/d/11hHSbluBcNfMYppvSMTfB9Pg4fHmJMvmduoaHFCXREE/edit#gid=123'),
    ).toBe(
      'https://docs.google.com/spreadsheets/d/11hHSbluBcNfMYppvSMTfB9Pg4fHmJMvmduoaHFCXREE/export?format=csv&gid=123',
    )
  })

  it('不是 Google 試算表網址 → null', () => {
    expect(toCsvUrl('https://example.com/data.csv')).toBeNull()
    expect(toCsvUrl('隨便打的字')).toBeNull()
  })
})
