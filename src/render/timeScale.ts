// render 層：時間刻度數學
// 只借用 d3-scale 的刻度計算，不用它畫圖（繪製一律自己用 SVG）。

import { scaleTime } from 'd3-scale'
import type { AbsoluteTimePoint } from '../core'

/** 一個時間點依精度展開成的「真實範圍」：例如 2010-06（月精度）涵蓋整個六月 */
export interface TimeSpan {
  start: Date
  end: Date
}

/** 把帶精度的時間點展開成範圍。月／年精度不假裝知道確切日期，而是涵蓋整段期間 */
export function timePointToSpan(point: AbsoluteTimePoint): TimeSpan {
  const v = point.value
  switch (point.precision) {
    case 'year': {
      const y = Number(v)
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) }
    }
    case 'month': {
      const [y, m] = v.split('-').map(Number)
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) }
    }
    case 'day': {
      const [y, m, d] = v.split('-').map(Number)
      return { start: new Date(y, m - 1, d), end: new Date(y, m - 1, d + 1) }
    }
    case 'minute': {
      const [datePart, timePart] = v.split('T')
      const [y, m, d] = datePart.split('-').map(Number)
      const [hh, mm] = timePart.split(':').map(Number)
      const start = new Date(y, m - 1, d, hh, mm)
      return { start, end: new Date(start.getTime() + 60_000) }
    }
  }
}

/** 範圍的中點（毫秒），點事件畫在這裡 */
export function spanMidpoint(span: TimeSpan): number {
  return (span.start.getTime() + span.end.getTime()) / 2
}

/** 依目前可視範圍與寬度，產生「漂亮」的刻度（日／週／月／年由 d3 自動挑選） */
export function getTicks(domain: [number, number], width: number): Date[] {
  const s = scaleTime()
    .domain([new Date(domain[0]), new Date(domain[1])])
    .range([0, width])
  return s.ticks(Math.max(2, Math.floor(width / 90)))
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 刻度標籤：年界顯示年、月界顯示月、日界顯示月/日、更細顯示時:分 */
export function formatTick(d: Date): string {
  if (d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0) {
    return String(d.getFullYear())
  }
  if (d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0) {
    return `${d.getMonth() + 1}月`
  }
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 目前可視範圍的文字說明（畫在左上角，讓使用者知道自己在哪個年代） */
export function formatRangeLabel(domain: [number, number]): string {
  const a = new Date(domain[0])
  const b = new Date(domain[1])
  const spanDays = (domain[1] - domain[0]) / 86_400_000
  if (spanDays > 365 * 2) {
    return `${a.getFullYear()} – ${b.getFullYear()}`
  }
  return `${a.getFullYear()}/${a.getMonth() + 1}/${a.getDate()} – ${b.getFullYear()}/${b.getMonth() + 1}/${b.getDate()}`
}
