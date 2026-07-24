// adapters 層：表格列分流器
// 把「已對應好標準欄位」的試算表列，分流成：成功事件／警告／待修正。
// 這裡實作 SPEC 第 9 節的所有髒資料規則。CSV / Google Sheet 匯入器
// 只負責把檔案讀成列（papaparse），欄位對應與分流邏輯都在這一層。
// （表頭別名、RawRow、髒資料分流屬「特定匯入格式」的知識，不放 core——
//   新增一種匯入來源時只動 adapters，是本專案的模組化鐵律。時間解析仍借 core。）
//
// 最高原則：匯入器永遠不靜默丟資料。
// 所有無法處理的列都要回報給使用者——資料是人辛苦整理的。

import type { AbsoluteTimePoint, SourceRef } from '../core'
import { parseDateTime } from '../core'

/** 標準欄位（SPEC 第 9 節的欄位對應表） */
export type StandardField =
  | 'start'
  | 'time'
  | 'end'
  | 'title'
  | 'description'
  | 'location'
  | 'track'
  | 'tags'
  | 'sources'

/** 表頭別名（不分大小寫）。mapHeader 用它把各種表頭認成標準欄位 */
const HEADER_ALIASES: Record<StandardField, string[]> = {
  start: ['start date', 'date', '日期', '開始日期'],
  time: ['start time', 'time', '時間'],
  end: ['end date', '結束日期'],
  title: ['title', '標題', '事件'],
  description: ['description', '說明', '描述'],
  location: ['location', '地點'],
  track: ['track', '軸線', '分類'],
  tags: ['tags', '標籤'],
  sources: ['source', 'url', '來源'],
}

/** 把試算表表頭認成標準欄位；認不得回傳 null */
export function mapHeader(header: string): StandardField | null {
  const key = header.trim().toLowerCase()
  for (const field of Object.keys(HEADER_ALIASES) as StandardField[]) {
    if (HEADER_ALIASES[field].includes(key)) return field
  }
  return null
}

/** 一列原始資料：標準欄位 → 字串值（尚未解析） */
export type RawRow = Partial<Record<StandardField, string>>

/** 分流成功的事件草稿（還不是完整的 HstEvent，track 歸屬由匯入器決定） */
export interface DraftEvent {
  id: string
  title: string
  start: AbsoluteTimePoint
  end?: AbsoluteTimePoint
  /** 結束日期欄寫「至今／迄今／持續中」時為 true：事件仍在進行中 */
  ongoing?: boolean
  description?: string
  location?: { name: string }
  track?: string
  tags?: string[]
  sources?: SourceRef[]
  /** 來自第幾列（0 起算），方便使用者回頭對照原始資料 */
  rowIndex: number
  /** 疑似重複：指向第一筆相同「日期＋標題」的事件 id。由使用者決定是否合併，程式不自動刪 */
  suspectedDuplicateOf?: string
}

/** 非致命問題（列被略過、疑似重複、時間欄被忽略⋯⋯） */
export interface RowWarning {
  rowIndex: number
  message: string
}

/** 待修正的列：無法解析，原樣保留給使用者處理 */
export interface UnresolvedRow {
  rowIndex: number
  row: RawRow
  reason: string
}

export interface TriageResult {
  /** 成功解析的事件 */
  events: DraftEvent[]
  /** 警告清單 */
  warnings: RowWarning[]
  /** 待修正清單（絕不靜默丟棄） */
  unresolved: UnresolvedRow[]
}

const isBlank = (v: string | undefined): boolean => v === undefined || v.trim() === ''

/** 結束日期欄的「進行中」寫法（SPEC 第 9 節） */
const RE_ONGOING = /^(至今|迄今|持續中|進行中|now|present|ongoing)$/i

/** 整列是否全空白 */
function isEmptyRow(row: RawRow): boolean {
  return Object.values(row).every((v) => isBlank(v))
}

/**
 * 分流試算表的列（SPEC 第 9 節髒資料處理規則）：
 * - 整列空白 → 略過，不報錯
 * - 有日期無標題 → 略過，記入警告清單
 * - 日期／時間無法解析、欄位錯位 → 收進「待修正」清單
 * - 同「日期＋標題」重複列 → 標記疑似重複，保留不刪
 */
export function triageRows(rows: RawRow[], options?: { idPrefix?: string }): TriageResult {
  const idPrefix = options?.idPrefix ?? 'evt-'
  const events: DraftEvent[] = []
  const warnings: RowWarning[] = []
  const unresolved: UnresolvedRow[] = []
  /** 「start value | 標題」→ 第一筆事件 id，用來偵測疑似重複 */
  const seen = new Map<string, string>()
  let serial = 0

  rows.forEach((row, rowIndex) => {
    // 規則：整列空白 → 略過，不報錯
    if (isEmptyRow(row)) return

    const title = row.title?.trim() ?? ''
    const hasDate = !isBlank(row.start)

    // 規則：有日期無標題 → 略過，記入警告清單
    if (hasDate && title === '') {
      warnings.push({
        rowIndex,
        message: `第 ${rowIndex + 1} 列有日期「${row.start!.trim()}」但沒有標題，已略過`,
      })
      return
    }

    // 沒有日期（含欄位錯位造成的空日期）→ 待修正
    if (!hasDate) {
      unresolved.push({
        rowIndex,
        row,
        reason: `第 ${rowIndex + 1} 列沒有日期，無法放上時間軸`,
      })
      return
    }

    // 解析開始日期（含時間欄；"09:00-18:00" 會自動拆成 start 與 end）
    const parsed = parseDateTime(row.start!, row.time)
    if (!parsed.ok) {
      // 規則：完全無法解析的日期（如「你好天」）、欄位錯位 → 待修正，絕不靜默丟棄
      unresolved.push({
        rowIndex,
        row,
        reason: `第 ${rowIndex + 1} 列：${parsed.reason}`,
      })
      return
    }
    for (const w of parsed.warnings) {
      warnings.push({ rowIndex, message: `第 ${rowIndex + 1} 列：${w}` })
    }

    // 結束日期欄（若時間欄已產生同日的 end，以明確的結束日期欄為優先）。
    // 寫「至今／持續中」→ 進行中事件（畫到今天），不是解析錯誤
    let end = parsed.end
    let ongoing = false
    if (!isBlank(row.end)) {
      if (RE_ONGOING.test(row.end!.trim())) {
        ongoing = true
        end = undefined
      } else {
        const parsedEnd = parseDateTime(row.end!)
        if (!parsedEnd.ok) {
          unresolved.push({
            rowIndex,
            row,
            reason: `第 ${rowIndex + 1} 列的結束日期：${parsedEnd.reason}`,
          })
          return
        }
        end = parsedEnd.start
      }
    }

    serial += 1
    const id = `${idPrefix}${String(serial).padStart(3, '0')}`
    const draft: DraftEvent = { id, title, start: parsed.start, rowIndex }
    if (end) draft.end = end
    if (ongoing) draft.ongoing = true
    if (!isBlank(row.description)) draft.description = row.description!.trim()
    if (!isBlank(row.location)) draft.location = { name: row.location!.trim() }
    if (!isBlank(row.track)) draft.track = row.track!.trim()
    if (!isBlank(row.tags)) {
      const tags = row.tags!.split(/[,、]/).map((t) => t.trim()).filter((t) => t !== '')
      if (tags.length > 0) draft.tags = tags
    }
    if (!isBlank(row.sources)) {
      const value = row.sources!.trim()
      draft.sources = [/^https?:\/\//i.test(value) ? { url: value } : { title: value }]
    }

    // 規則：同「日期＋標題」重複列 → 標記疑似重複，由使用者決定是否合併
    const dupKey = `${parsed.start.value}|${title}`
    const firstId = seen.get(dupKey)
    if (firstId) {
      draft.suspectedDuplicateOf = firstId
      warnings.push({
        rowIndex,
        message: `第 ${rowIndex + 1} 列「${title}」與先前的列（${firstId}）日期與標題相同，疑似重複，請確認是否合併`,
      })
    } else {
      seen.set(dupKey, id)
    }

    events.push(draft)
  })

  return { events, warnings, unresolved }
}
