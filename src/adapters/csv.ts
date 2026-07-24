// adapters 層：CSV 匯入
// 用 papaparse 把 CSV 文字讀成列，欄位對應與髒資料分流全部交給 core（rows.ts）。
// 這一層不碰畫面，也不知道 CSV 是使用者上傳的還是從 Google Sheet 抓來的。

import Papa from 'papaparse'
import type { HstEvent, TimelineDocument } from '../core'
import type { DraftEvent, RawRow, StandardField, TriageResult } from './rows'
import { mapHeader, triageRows } from './rows'

/** 表頭對應結果：原始表頭 → 認出的標準欄位（null = 認不得，該欄忽略） */
export interface HeaderMapping {
  original: string
  mapped: StandardField | null
}

export type CsvParseOutcome =
  | {
      ok: true
      headers: HeaderMapping[]
      triage: TriageResult
      /** 表頭上方的主題文字（若有），當作建議的圖層標題 */
      titleHint?: string
    }
  | { ok: false; error: string }

/** 把 CSV 文字解析並分流。回傳成功事件／警告／待修正三堆（絕不靜默丟資料） */
export function parseCsvText(text: string): CsvParseOutcome {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: false,
  })
  const rows = parsed.data.filter((r) => Array.isArray(r))
  const nonEmpty = (r: string[]) => r.some((cell) => cell && cell.trim() !== '')

  // 在前 10 個非空列中往下尋找表頭列：能同時認出「日期」與「標題」的那一列才算表頭。
  // 這樣第一列就算是主題標題（例如「同婚大事記」）也能正確匯入。
  let headerIndex = -1
  let headers: HeaderMapping[] = []
  let scanned = 0
  for (let i = 0; i < rows.length && scanned < 10; i++) {
    if (!nonEmpty(rows[i])) continue
    scanned++
    const candidate: HeaderMapping[] = rows[i].map((h) => ({
      original: (h ?? '').trim(),
      mapped: mapHeader(h ?? ''),
    }))
    if (candidate.some((h) => h.mapped === 'start') && candidate.some((h) => h.mapped === 'title')) {
      headerIndex = i
      headers = candidate
      break
    }
  }

  if (headerIndex < 0) {
    const first = rows.find(nonEmpty)
    if (!first) {
      return { ok: false, error: '檔案是空的，找不到任何內容' }
    }
    const found = first.map((h) => (h ?? '').trim()).filter((h) => h !== '').join('、')
    return {
      ok: false,
      error:
        `在前 10 列裡認不出表頭——至少需要「日期」與「標題」兩欄。` +
        `第一列的內容是：${found}。支援的表頭例如「日期／Start Date」「標題／Title／事件」`,
    }
  }

  // 表頭上方的第一個非空儲存格 → 建議的圖層標題
  let titleHint: string | undefined
  for (let i = 0; i < headerIndex; i++) {
    const cell = rows[i].find((c) => c && c.trim() !== '')
    if (cell) {
      titleHint = cell.trim()
      break
    }
  }

  // 資料列 → RawRow（標準欄位 → 字串值）
  const rawRows: RawRow[] = rows.slice(headerIndex + 1).map((cells) => {
    const row: RawRow = {}
    headers.forEach((h, i) => {
      const value = cells[i]
      // 同名欄位以先出現者為準，不覆寫
      if (h.mapped && value !== undefined && row[h.mapped] === undefined) {
        row[h.mapped] = value
      }
    })
    return row
  })

  return { ok: true, headers, triage: triageRows(rawRows), titleHint }
}

/**
 * 逐筆修正用：使用者改完一列的欄位後重新解析。
 * 成功回傳事件草稿（id 是暫代的，由呼叫端重新編號），失敗回傳中文原因。
 */
export function retryRow(row: RawRow): { ok: true; draft: DraftEvent } | { ok: false; reason: string } {
  const triage = triageRows([row])
  if (triage.events.length === 1) {
    return { ok: true, draft: triage.events[0] }
  }
  if (triage.unresolved.length === 1) {
    return { ok: false, reason: triage.unresolved[0].reason }
  }
  if (triage.warnings.length > 0) {
    return { ok: false, reason: triage.warnings[0].message }
  }
  return { ok: false, reason: '這一列是空的' }
}

/** 匯入選項 */
export interface BuildDocumentOptions {
  title: string
  sourceType: 'csv' | 'google-sheet'
  sourceUrl?: string
}

/**
 * 把分流後（且經使用者修正、確認）的事件草稿組成一份合法的時間軸文件。
 * 有「軸線／分類」欄的列依值分軌；沒有的歸入「匯入資料」軸。
 */
export function draftsToDocument(
  drafts: DraftEvent[],
  options: BuildDocumentOptions,
): TimelineDocument {
  // 依出現順序收集軸線名稱
  const trackTitles: string[] = []
  for (const d of drafts) {
    const t = d.track?.trim() || '匯入資料'
    if (!trackTitles.includes(t)) trackTitles.push(t)
  }
  const trackIdOf = (title: string) => `track-${trackTitles.indexOf(title) + 1}`

  const events: HstEvent[] = drafts.map((d) => {
    const ev: HstEvent = {
      id: d.id,
      track: trackIdOf(d.track?.trim() || '匯入資料'),
      title: d.title,
      start: d.start,
    }
    if (d.end) ev.end = d.end
    if (d.ongoing) ev.ongoing = true
    if (d.description) ev.description = d.description
    if (d.location) ev.location = d.location
    if (d.tags) ev.tags = d.tags
    if (d.sources) ev.sources = d.sources
    return ev
  })

  const today = new Date().toISOString().slice(0, 10)
  return {
    hackstory: '0.3',
    id: `imported-${Date.now()}`,
    meta: {
      title: options.title,
      license: 'CC-BY-4.0',
      language: 'zh-TW',
      created: today,
      updated: today,
      revision: 1,
      source: {
        type: options.sourceType,
        ...(options.sourceUrl ? { url: options.sourceUrl } : {}),
      },
    },
    tracks: trackTitles.map((title, i) => ({ id: `track-${i + 1}`, title, order: i + 1 })),
    events,
  }
}
