// render 層：時間軸視覺化引擎
// 自己用 SVG 畫（專案禁令：不引入 vis.js 等任何現成時間軸函式庫）。
// 這一層只認得 core 的資料模型，不知道資料是從 CSV、JSON 還是別的地方來的，
// 也不知道「圖層」怎麼管理——它只負責把收到的多份文件畫出來。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AbsoluteTimePoint, TimelineDocument } from '../core'
import { isAbsolute } from '../core'
import { assignLanes, estimateTextWidth, truncate } from './layout'
import { formatRangeLabel, formatTick, getTicks, spanMidpoint, timePointToSpan } from './timeScale'

/** 尺度模式（像 Google 日曆的 日/週/月/年 切換） */
export type ScaleMode = 'day' | 'week' | 'month' | 'year'

/** ui 層下的指令：「切到某個尺度」。nonce 遞增代表新的一次點擊 */
export interface ScaleRequest {
  mode: ScaleMode
  nonce: number
}

/** 一份要畫的文件。color 為圖層顏色，覆寫文件內軸線的顏色（用來辨識圖層） */
export interface TimelineSource {
  id: string
  doc: TimelineDocument
  color?: string
}

interface Props {
  sources: TimelineSource[]
  scaleRequest?: ScaleRequest | null
  /** 縮放後回報目前落在哪個尺度，讓 ui 層的按鈕高亮 */
  onScaleModeChange?: (mode: ScaleMode) => void
}

const DAY = 86_400_000
const AXIS_H = 32 // 頂部刻度列高度
const TRACK_LABEL_H = 26 // 軸線標題列高度
const LANE_H = 26 // 每條車道高度
const BAND_GAP = 12 // 軸線之間的間距
const DOT_R = 5

/** 各尺度按鈕對應的可視時間跨度 */
const SCALE_SPANS: Record<Exclude<ScaleMode, 'year'>, number> = {
  day: 14 * DAY,
  week: 91 * DAY,
  month: 730 * DAY,
}
const MIN_SPAN = DAY / 4 // 最多放大到 6 小時
const MAX_SPAN = 400 * 365 * DAY // 最多縮小到 400 年

/** 軸線沒指定顏色時輪流使用的預設色 */
const PALETTE = ['#3b6ea5', '#d97706', '#0f766e', '#9333ea', '#be123c', '#4d7c0f']

/** 依事件推算所有文件合起來的時間範圍（毫秒） */
function eventsExtent(docs: TimelineDocument[]): [number, number] | null {
  let min = Infinity
  let max = -Infinity
  for (const doc of docs) {
    for (const ev of doc.events) {
      if (isAbsolute(ev.start)) {
        const s = timePointToSpan(ev.start)
        min = Math.min(min, s.start.getTime())
        max = Math.max(max, s.end.getTime())
      }
      if (ev.end && isAbsolute(ev.end)) {
        max = Math.max(max, timePointToSpan(ev.end).end.getTime())
      }
    }
  }
  return min < max ? [min, max] : null
}

/**
 * 初始可視範圍：疊多個圖層時以最外層（第一份）的 display.range 建議為準（SPEC 第 8 節），
 * 否則用所有事件的實際範圍，前後各留 3% 呼吸空間。
 */
function initialDomainOf(sources: TimelineSource[]): [number, number] {
  let extent = eventsExtent(sources.map((s) => s.doc))
  const range = sources[0]?.doc.display?.range
  if (range && /^\d{4}$/.test(range.start) && /^\d{4}$/.test(range.end)) {
    extent = [
      new Date(Number(range.start), 0, 1).getTime(),
      new Date(Number(range.end) + 1, 0, 1).getTime(),
    ]
  }
  if (!extent) {
    const now = Date.now()
    return [now - 365 * DAY, now + 365 * DAY]
  }
  const pad = (extent[1] - extent[0]) * 0.03
  return [extent[0] - pad, extent[1] + pad]
}

export function TimelineView({ sources, scaleRequest, onScaleModeChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(960)

  const initialDomain = useMemo(() => initialDomainOf(sources), [sources])

  // domainState 為 null 代表「跟著初始範圍走」（尚未縮放，或按了「年」回到全貌）。
  // 這樣切換圖層顯示隱藏時，使用者已縮放的視野不會被重設。
  const [domainState, setDomainState] = useState<[number, number] | null>(null)
  const domain = domainState ?? initialDomain
  const domainRef = useRef(domain)
  domainRef.current = domain

  // 量測容器寬度，讓 SVG 跟著視窗伸縮
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ui 層的尺度按鈕：日/週/月 → 以目前中心切換跨度；年 → 回到全貌
  useEffect(() => {
    if (!scaleRequest) return
    if (scaleRequest.mode === 'year') {
      setDomainState(null)
      return
    }
    const span = SCALE_SPANS[scaleRequest.mode]
    const [a, b] = domainRef.current
    const center = (a + b) / 2
    setDomainState([center - span / 2, center + span / 2])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleRequest?.nonce])

  // 回報目前尺度，讓按鈕高亮跟著縮放狀態走
  useEffect(() => {
    const span = domain[1] - domain[0]
    const mode: ScaleMode =
      span <= 30 * DAY ? 'day' : span <= 200 * DAY ? 'week' : span <= 1500 * DAY ? 'month' : 'year'
    onScaleModeChange?.(mode)
  }, [domain, onScaleModeChange])

  // 滑鼠滾輪縮放（以游標位置為錨點）。需要 passive: false 才能擋掉頁面捲動
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const f = (e.clientX - rect.left) / rect.width
      const [a, b] = domainRef.current
      const span = b - a
      const k = Math.exp(e.deltaY * 0.0015)
      const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * k))
      const anchor = a + f * span
      const a2 = anchor - f * newSpan
      setDomainState([a2, a2 + newSpan])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [sources.length > 0]) // 空狀態沒有 svg，出現後要重掛監聽

  // 拖曳平移
  const dragState = useRef<{ startX: number; domain: [number, number] } | null>(null)

  // ---- 排版計算 ----
  const layout = useMemo(() => {
    const [a, b] = domain
    const x = (t: number) => ((t - a) / (b - a)) * width

    let y = AXIS_H + 8
    let bandIndex = 0

    const bands = sources.flatMap((source) => {
      const tracks = [...source.doc.tracks].sort((t1, t2) => (t1.order ?? 0) - (t2.order ?? 0))
      return tracks.map((track) => {
        const color = source.color ?? track.color ?? PALETTE[bandIndex % PALETTE.length]
        // 單軸文件直接用文件標題；多軸文件標成「文件｜軸線」
        const label =
          tracks.length === 1
            ? source.doc.meta.title
            : `${source.doc.meta.title}｜${track.title}`
        bandIndex++

        const items = source.doc.events
          .filter((ev) => ev.track === track.id)
          .flatMap((ev) => {
            const start = ev.start
            if (!isAbsolute(start)) return [] // 相對時間 Phase 2 才畫
            const startSpan = timePointToSpan(start)
            const endPoint = ev.end && isAbsolute(ev.end) ? (ev.end as AbsoluteTimePoint) : null

            let kind: 'dot' | 'bar'
            let shapeL: number
            let shapeR: number
            if (endPoint) {
              // 區間事件 = 長條：從開始範圍的頭畫到結束範圍的尾
              const endSpan = timePointToSpan(endPoint)
              const x1 = x(startSpan.start.getTime())
              const x2 = Math.max(x(endSpan.end.getTime()), x1 + 6)
              kind = 'bar'
              shapeL = x1
              shapeR = x2
            } else {
              // 點事件 = 圓點：畫在精度範圍的中點
              const cx = x(spanMidpoint(startSpan))
              kind = 'dot'
              shapeL = cx - DOT_R
              shapeR = cx + DOT_R
            }

            const text = truncate(ev.title, 16)
            const labelW = estimateTextWidth(text)
            // 標題預設放在圖形右側；右邊放不下時翻到左側，避免被畫面邊緣切掉
            const labelSide: 'right' | 'left' =
              shapeR + 6 + labelW > width && shapeL - 6 - labelW > 0 ? 'left' : 'right'
            const occL = labelSide === 'left' ? shapeL - 6 - labelW : shapeL
            const occR = labelSide === 'right' ? shapeR + 6 + labelW : shapeR
            return [{ ev, kind, shapeL, shapeR, label: text, labelSide, occL, occR }]
          })
          .sort((p, q) => p.occL - q.occL)

        const lanes = assignLanes(items.map((it) => ({ left: it.occL, right: it.occR })))
        const laneCount = items.length > 0 ? Math.max(...lanes) + 1 : 1
        const bandTop = y
        const bandH = TRACK_LABEL_H + laneCount * LANE_H + 6
        y += bandH + BAND_GAP

        return {
          key: `${source.id}/${track.id}`,
          label,
          color,
          bandTop,
          bandH,
          items: items.map((it, j) => ({ ...it, lane: lanes[j] })),
        }
      })
    })

    return { bands, height: Math.max(y + 8, 320), x }
  }, [sources, domain, width])

  // 沒有任何可見圖層：顯示提示文字
  if (sources.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-slate-400">
        沒有可顯示的圖層——請在左側面板勾選或載入 .hst.json 檔案
      </div>
    )
  }

  const ticks = getTicks(domain, width)

  return (
    <div ref={containerRef} className="h-full w-full select-none overflow-y-auto">
      <svg
        ref={svgRef}
        id="hackstory-timeline-svg"
        width={width}
        height={layout.height}
        className="block cursor-grab bg-white active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          dragState.current = { startX: e.clientX, domain }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = dragState.current
          if (!drag) return
          const [a, b] = drag.domain
          const dt = ((e.clientX - drag.startX) / width) * (b - a)
          setDomainState([a - dt, b - dt])
        }}
        onPointerUp={() => (dragState.current = null)}
        onPointerCancel={() => (dragState.current = null)}
      >
        {/* 直式格線 */}
        {ticks.map((d, i) => (
          <line
            key={i}
            x1={layout.x(d.getTime())}
            x2={layout.x(d.getTime())}
            y1={AXIS_H}
            y2={layout.height}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* 頂部刻度列 */}
        <line x1={0} x2={width} y1={AXIS_H} y2={AXIS_H} stroke="#cbd5e1" />
        {ticks.map((d, i) => (
          <text
            key={i}
            x={layout.x(d.getTime())}
            y={AXIS_H - 10}
            textAnchor="middle"
            fontSize={12}
            fill="#64748b"
          >
            {formatTick(d)}
          </text>
        ))}
        {/* 左上角：目前可視範圍 */}
        <text x={8} y={14} fontSize={11} fill="#94a3b8">
          {formatRangeLabel(domain)}
        </text>

        {/* 軸線與事件 */}
        {layout.bands.map(({ key, label, color, bandTop, bandH, items }) => (
          <g key={key}>
            <rect x={0} y={bandTop} width={width} height={bandH} fill={color} opacity={0.05} />
            <rect x={0} y={bandTop} width={3} height={bandH} fill={color} />
            <text x={12} y={bandTop + 18} fontSize={13} fontWeight={700} fill={color}>
              {label}
            </text>

            {items.map(({ ev, kind, shapeL, shapeR, label: text, labelSide, lane }) => {
              const cy = bandTop + TRACK_LABEL_H + lane * LANE_H + LANE_H / 2
              const fill = ev.color ?? color
              return (
                <g key={ev.id}>
                  {kind === 'bar' ? (
                    <rect
                      x={shapeL}
                      y={cy - 6}
                      width={shapeR - shapeL}
                      height={12}
                      rx={6}
                      fill={fill}
                      opacity={0.85}
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={DOT_R} fill={fill} />
                  )}
                  <text
                    x={labelSide === 'right' ? shapeR + 6 : shapeL - 6}
                    y={cy + 4}
                    textAnchor={labelSide === 'right' ? 'start' : 'end'}
                    fontSize={12}
                    fill="#334155"
                  >
                    {text}
                  </text>
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
}
