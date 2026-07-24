// 表格列分流器的測試。
// SPEC 第 9 節的每一種髒資料狀況，這裡各有一個對應的測試——
// 「這些不是理論，全部來自你的真實資料」。
import { describe, expect, it } from 'vitest'
import type { RawRow } from './rows'
import { mapHeader, triageRows } from './rows'

describe('表頭對應（欄位別名，不分大小寫）', () => {
  it('英文與中文表頭都認得', () => {
    expect(mapHeader('Start Date')).toBe('start')
    expect(mapHeader('日期')).toBe('start')
    expect(mapHeader('開始日期')).toBe('start')
    expect(mapHeader('Start Time')).toBe('time')
    expect(mapHeader('時間')).toBe('time')
    expect(mapHeader('End Date')).toBe('end')
    expect(mapHeader('結束日期')).toBe('end')
    expect(mapHeader('Title')).toBe('title')
    expect(mapHeader('事件')).toBe('title')
    expect(mapHeader('說明')).toBe('description')
    expect(mapHeader('地點')).toBe('location')
    expect(mapHeader('分類')).toBe('track')
    expect(mapHeader('標籤')).toBe('tags')
    expect(mapHeader('來源')).toBe('sources')
  })

  it('大小寫與前後空白不影響：「 TITLE 」也認得', () => {
    expect(mapHeader(' TITLE ')).toBe('title')
    expect(mapHeader('date')).toBe('start')
  })

  it('認不得的表頭回傳 null，交給使用者處理', () => {
    expect(mapHeader('隨便什麼欄')).toBeNull()
  })
})

describe('SPEC 第 9 節：髒資料處理規則', () => {
  it('【規則 1】整列空白 → 略過，不報錯也不進待修正', () => {
    const rows: RawRow[] = [
      { start: '2017/5/24', title: '正常事件' },
      { start: '', title: '   ' }, // 整列空白
      {},
    ]
    const result = triageRows(rows)
    expect(result.events.length).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it('【規則 2】有日期無標題 → 略過，但記入警告清單（不靜默）', () => {
    const rows: RawRow[] = [{ start: '2017/5/24', title: '' }]
    const result = triageRows(rows)
    expect(result.events).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].message).toContain('沒有標題')
  })

  it('【規則 3】Start Time 是「09:00-18:00」→ start 取 09:00、end 取 18:00（同日）', () => {
    const rows: RawRow[] = [{ start: '2016/11/24', time: '09:00-18:00', title: '公聽會' }]
    const result = triageRows(rows)
    expect(result.events.length).toBe(1)
    expect(result.events[0].start.value).toBe('2016-11-24T09:00')
    expect(result.events[0].end?.value).toBe('2016-11-24T18:00')
  })

  it('【規則 4】「2017/02/20」與「2017/3/24」混用 → 一律正規化成同一種格式', () => {
    const rows: RawRow[] = [
      { start: '2017/02/20', title: '司法院受理釋憲' },
      { start: '2017/3/24', title: '憲法法庭言詞辯論' },
    ]
    const result = triageRows(rows)
    expect(result.events[0].start.value).toBe('2017-02-20')
    expect(result.events[1].start.value).toBe('2017-03-24')
  })

  it('【規則 5】日期是「2010年6月」→ 解析為 precision: "month"，不假裝知道是哪一天', () => {
    const rows: RawRow[] = [{ start: '2010年6月', title: '食安事件爆發' }]
    const result = triageRows(rows)
    expect(result.events[0].start.value).toBe('2010-06')
    expect(result.events[0].start.precision).toBe('month')
    // 原始輸入字串保留，方便回溯
    expect(result.events[0].start.raw).toBe('2010年6月')
  })

  it('【規則 6】完全無法解析的日期（「你好天」）→ 收進待修正清單，絕不靜默丟棄', () => {
    const rows: RawRow[] = [{ start: '你好天', title: '不知道哪天發生的事' }]
    const result = triageRows(rows)
    expect(result.events).toEqual([])
    expect(result.unresolved.length).toBe(1)
    expect(result.unresolved[0].reason).toContain('你好天')
    // 原始列原樣保留，讓使用者能修
    expect(result.unresolved[0].row).toEqual(rows[0])
  })

  it('【規則 7】同日同標題重複列（2016/12/26 出現三次）→ 標記疑似重複，全部保留，程式不自動刪', () => {
    const rows: RawRow[] = [
      { start: '2016/12/26', title: '民法修正案出委員會' },
      { start: '2016/12/26', title: '民法修正案出委員會' },
      { start: '2016/12/26', title: '民法修正案出委員會' },
    ]
    const result = triageRows(rows)
    // 三筆都在，沒有一筆被刪
    expect(result.events.length).toBe(3)
    // 第一筆是正主，後兩筆標記疑似重複並指向它
    expect(result.events[0].suspectedDuplicateOf).toBeUndefined()
    expect(result.events[1].suspectedDuplicateOf).toBe(result.events[0].id)
    expect(result.events[2].suspectedDuplicateOf).toBe(result.events[0].id)
    // 警告清單有兩筆重複提醒
    expect(result.warnings.filter((w) => w.message.includes('疑似重複')).length).toBe(2)
  })

  it('【規則 8】欄位整體錯位的壞列（日期格裡是地名）→ 收進待修正清單', () => {
    const rows: RawRow[] = [
      { start: '台北市', title: '2017/5/24' }, // 欄位錯位：日期與標題對調了
    ]
    const result = triageRows(rows)
    expect(result.events).toEqual([])
    expect(result.unresolved.length).toBe(1)
  })
})

describe('其他欄位的轉換', () => {
  it('標籤以逗號（或頓號）分隔，空白自動修剪', () => {
    const rows: RawRow[] = [{ start: '2017/5/24', title: '事件', tags: '釋憲, 大法官、人權' }]
    const result = triageRows(rows)
    expect(result.events[0].tags).toEqual(['釋憲', '大法官', '人權'])
  })

  it('來源是網址 → 存成 { url }；不是網址 → 存成 { title }', () => {
    const rows: RawRow[] = [
      { start: '2017/5/24', title: 'A', sources: 'https://cons.judicial.gov.tw/' },
      { start: '2017/5/25', title: 'B', sources: '自由時報報導' },
    ]
    const result = triageRows(rows)
    expect(result.events[0].sources).toEqual([{ url: 'https://cons.judicial.gov.tw/' }])
    expect(result.events[1].sources).toEqual([{ title: '自由時報報導' }])
  })

  it('明確的結束日期欄 → 區間事件', () => {
    const rows: RawRow[] = [{ start: '2006/10/11', end: '2006/10/31', title: '草案遭退回' }]
    const result = triageRows(rows)
    expect(result.events[0].start.value).toBe('2006-10-11')
    expect(result.events[0].end?.value).toBe('2006-10-31')
  })

  it('結束日期寫「至今／持續中／now」→ 進行中事件（ongoing），不是解析錯誤', () => {
    for (const word of ['至今', '迄今', '持續中', 'now', 'Present']) {
      const result = triageRows([{ start: '2024/9/1', end: word, title: '進行中的事件' }])
      expect(result.unresolved, `「${word}」不應進待修正`).toEqual([])
      expect(result.events[0].ongoing).toBe(true)
      expect(result.events[0].end).toBeUndefined()
    }
  })

  it('結束日期無法解析 → 整列進待修正（不會只丟掉 end 假裝沒事）', () => {
    const rows: RawRow[] = [{ start: '2006/10/11', end: '月底吧', title: '草案遭退回' }]
    const result = triageRows(rows)
    expect(result.events).toEqual([])
    expect(result.unresolved.length).toBe(1)
  })

  it('事件 id 依序產生（evt-001、evt-002⋯⋯），並記住原始列號', () => {
    const rows: RawRow[] = [
      {},
      { start: '2017/5/24', title: 'A' },
      { start: '2017/5/25', title: 'B' },
    ]
    const result = triageRows(rows)
    expect(result.events[0].id).toBe('evt-001')
    expect(result.events[1].id).toBe('evt-002')
    expect(result.events[0].rowIndex).toBe(1)
    expect(result.events[1].rowIndex).toBe(2)
  })
})
