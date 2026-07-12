// render 層：時間軸視覺化引擎
// 自己用 SVG 畫（專案禁令：不引入 vis.js 等任何現成時間軸函式庫）。
// 這一層只認得 core 的資料模型，不知道資料是從 CSV、JSON 還是別的地方來的，
// 也不知道「圖層」怎麼管理——它只負責把收到的多份文件畫出來。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AbsoluteTimePoint, HstEvent, TimelineDocument } from '../core'
import { isAbsolute } from '../core'
import { assignLanes, estimateTextWidth, truncate } from './layout'
import {
  formatPointShort,
  formatRangeLabel,
  formatTick,
  getTicks,
  spanMidpoint,
  timePointToSpan,
} from './timeScale'

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

/** 使用者點選了一個事件：render 層回報給 ui 層，由 ui 顯示詳情卡 */
export interface EventSelection {
  /** 圖層 id + 事件 id 的組合鍵（事件 id 只保證在單一文件內唯一） */
  key: string
  /** 事件所屬的圖層 id（ui 要改事件內容時用） */
  sourceId: string
  event: HstEvent
  docTitle: string
  trackTitle: string
  color: string
  /** 點擊位置（視窗座標），ui 用來決定詳情卡放哪裡 */
  clientX: number
  clientY: number
}

interface Props {
  sources: TimelineSource[]
  scaleRequest?: ScaleRequest | null
  /** 縮放後回報目前落在哪個尺度，讓 ui 層的按鈕高亮 */
  onScaleModeChange?: (mode: ScaleMode) => void
  /** 是否在事件標題前顯示日期（預設顯示） */
  showDates?: boolean
  /** 日期是否含年份（整條軸都在同一年時可關掉，預設顯示） */
  showYears?: boolean
  /** 是否繪製事件關係線（SPEC 第 7 節 relations，預設顯示） */
  showRelations?: boolean
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  /** 點事件 → 回報選取；點空白處 → 回報 null */
  onEventSelect?: (selection: EventSelection | null) => void
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

/** 關係類型的中文名稱（沒有自訂 label 時顯示） */
const RELATION_LABELS: Record<string, string> = {
  causes: '導致',
  responds_to: '回應',
  derives_from: '衍生自',
  contradicts: '與之矛盾',
  same_event: '同一事件',
}

export function TimelineView({
  sources,
  scaleRequest,
  onScaleModeChange,
  showDates = true,
  showYears = true,
  showRelations = true,
  selectedKey,
  onEventSelect,
}: Props) {
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
  // 這次按下之後有沒有實際拖動（拖動結束的 click 不應該被當成「點空白處取消選取」）
  const draggedRef = useRef(false)
  // 滑鼠懸停的事件：不用點擊，關係線就會先亮起來
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // ---- 排版計算 ----
  const layout = useMemo(() => {
    const [a, b] = domain
    const x = (t: number) => ((t - a) / (b - a)) * width

    let y = AXIS_H + 8
    let bandIndex = 0

    const bands = sources.flatMap((source) => {
      const tracks = [...source.doc.tracks].sort((t1, t2) => (t1.order ?? 0) - (t2.order ?? 0))
      return tracks.map((track) => {
        // 顏色優先序：多軸文件以文件內的軸線配色區分（圖層色只當後備）；
        // 單軸文件以圖層色為主（面板改色才會生效）
        const color =
          tracks.length > 1
            ? track.color ?? source.color ?? PALETTE[bandIndex % PALETTE.length]
            : source.color ?? track.color ?? PALETTE[bandIndex % PALETTE.length]
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

            // 關鍵事件（importance 5）：放大、粗體、光暈，一眼看到
            const isKey = (ev.importance ?? 0) >= 5
            const dotR = isKey ? DOT_R + 2.5 : DOT_R

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
              shapeL = cx - dotR
              shapeR = cx + dotR
            }

            const text = truncate(ev.title, 16)
            // 日期前綴（「顯示事件日期」「含年份」兩個勾選框控制）
            const dateLabel = showDates ? formatPointShort(start, showYears) : ''
            const labelW = estimateTextWidth(dateLabel ? `${dateLabel} ${text}` : text)
            // 標題預設放在圖形右側；右邊放不下時翻到左側，避免被畫面邊緣切掉
            const labelSide: 'right' | 'left' =
              shapeR + 6 + labelW > width && shapeL - 6 - labelW > 0 ? 'left' : 'right'
            const occL = labelSide === 'left' ? shapeL - 6 - labelW : shapeL
            const occR = labelSide === 'right' ? shapeR + 6 + labelW : shapeR
            return [{ ev, kind, isKey, shapeL, shapeR, label: text, dateLabel, labelSide, occL, occR }]
          })
          .sort((p, q) => p.occL - q.occL)

        const lanes = assignLanes(items.map((it) => ({ left: it.occL, right: it.occR })))
        const laneCount = items.length > 0 ? Math.max(...lanes) + 1 : 1
        const bandTop = y
        const bandH = TRACK_LABEL_H + laneCount * LANE_H + 6
        y += bandH + BAND_GAP

        return {
          key: `${source.id}/${track.id}`,
          sourceId: source.id,
          docTitle: source.doc.meta.title,
          trackTitle: track.title,
          label,
          color,
          bandTop,
          bandH,
          items: items.map((it, j) => ({
            ...it,
            lane: lanes[j],
            cy: bandTop + TRACK_LABEL_H + lanes[j] * LANE_H + LANE_H / 2,
          })),
        }
      })
    })

    // 每個事件圖形的中心點，供關係線定位
    const anchors = new Map<string, { x: number; y: number }>()
    for (const band of bands) {
      for (const it of band.items) {
        anchors.set(`${band.sourceId}/${it.ev.id}`, { x: (it.shapeL + it.shapeR) / 2, y: it.cy })
      }
    }

    // 關係線：只連同一份文件內、兩端都畫得出來的事件。
    // 路徑與說明標籤的位置在這裡先算好，說明標籤會畫在最上層避免與事件文字交疊。
    const relationLines = sources.flatMap((source) =>
      (source.doc.relations ?? []).flatMap((rel, i) => {
        const fromKey = `${source.id}/${rel.from}`
        const toKey = `${source.id}/${rel.to}`
        const from = anchors.get(fromKey)
        const to = anchors.get(toKey)
        if (!from || !to) return []

        const sameLevel = Math.abs(from.y - to.y) < 12
        const midY = sameLevel ? Math.min(from.y, to.y) - 44 : (from.y + to.y) / 2
        const d = sameLevel
          ? `M ${from.x} ${from.y - 8} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 8}`
          : `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`

        const label = rel.label ?? RELATION_LABELS[rel.type] ?? rel.type
        // 標籤底框的尺寸與位置（夾在畫面內，不被切出去）
        const labelW = estimateTextWidth(label, 11) + 18
        const labelX = Math.min(
          Math.max((from.x + to.x) / 2, labelW / 2 + 4),
          width - labelW / 2 - 4,
        )
        return [
          {
            id: `${source.id}/rel-${i}`,
            d,
            fromKey,
            toKey,
            type: rel.type,
            label,
            labelW,
            labelX,
            labelY: midY,
          },
        ]
      }),
    )

    return { bands, relationLines, height: Math.max(y + 8, 320), x }
  }, [sources, domain, width, showDates, showYears])

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
          draggedRef.current = false
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = dragState.current
          if (!drag) return
          if (Math.abs(e.clientX - drag.startX) > 4) draggedRef.current = true
          const [a, b] = drag.domain
          const dt = ((e.clientX - drag.startX) / width) * (b - a)
          setDomainState([a - dt, b - dt])
        }}
        onPointerUp={() => (dragState.current = null)}
        onPointerCancel={() => (dragState.current = null)}
        onClick={() => {
          // 點空白處（不是拖曳）→ 取消選取
          if (!draggedRef.current) onEventSelect?.(null)
        }}
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

        {/* 軸線底色與標題 */}
        {layout.bands.map(({ key, label, color, bandTop, bandH }) => (
          <g key={`${key}-bg`}>
            <rect x={0} y={bandTop} width={width} height={bandH} fill={color} opacity={0.05} />
            <rect x={0} y={bandTop} width={3} height={bandH} fill={color} />
            <text x={12} y={bandTop + 18} fontSize={13} fontWeight={700} fill={color}>
              {label}
            </text>
          </g>
        ))}

        {/* 事件關係線（畫在事件圖形下方；點選事件時相關的線會亮起並顯示說明） */}
        {showRelations && layout.relationLines.length > 0 && (
          <g pointerEvents="none">
            <defs>
              <marker
                id="hst-rel-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {layout.relationLines.map(({ id, d, fromKey, toKey, type }) => {
              // 點選或滑鼠懸停的事件，其關係線都會亮起
              const active =
                selectedKey === fromKey ||
                selectedKey === toKey ||
                hoveredKey === fromKey ||
                hoveredKey === toKey
              return (
                <path
                  key={id}
                  d={d}
                  fill="none"
                  stroke={active ? '#d97706' : '#94a3b8'}
                  strokeWidth={active ? 2.5 : 1.25}
                  strokeDasharray={type === 'same_event' ? '4 3' : undefined}
                  opacity={active ? 0.95 : 0.4}
                  markerEnd="url(#hst-rel-arrow)"
                />
              )
            })}
          </g>
        )}

        {/* 事件 */}
        {layout.bands.map(({ key, sourceId, docTitle, trackTitle, color, items }) => (
          <g key={key}>
            {items.map(({ ev, kind, isKey, shapeL, shapeR, label: text, dateLabel, labelSide, cy }) => {
              const fill = ev.color ?? color
              const eventKey = `${sourceId}/${ev.id}`
              const isSelected = selectedKey === eventKey
              const dotR = isKey ? DOT_R + 2.5 : DOT_R
              const barH = isKey ? 16 : 12
              return (
                <g
                  key={ev.id}
                  className="cursor-pointer"
                  // 按在事件上不啟動拖曳，讓 click 正常送達
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setHoveredKey(eventKey)}
                  onMouseLeave={() => setHoveredKey((prev) => (prev === eventKey ? null : prev))}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventSelect?.({
                      key: eventKey,
                      sourceId,
                      event: ev,
                      docTitle,
                      trackTitle,
                      color: fill,
                      clientX: e.clientX,
                      clientY: e.clientY,
                    })
                  }}
                >
                  {/* 看不見的感應區：滑鼠不用精準壓在小圓點上也能 hover／點擊 */}
                  {kind === 'bar' ? (
                    <rect
                      x={shapeL - 6}
                      y={cy - barH / 2 - 7}
                      width={shapeR - shapeL + 12}
                      height={barH + 14}
                      fill="transparent"
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={dotR + 8} fill="transparent" />
                  )}
                  {/* 關鍵事件的常駐光暈 */}
                  {isKey &&
                    (kind === 'bar' ? (
                      <rect
                        x={shapeL - 4}
                        y={cy - barH / 2 - 4}
                        width={shapeR - shapeL + 8}
                        height={barH + 8}
                        rx={(barH + 8) / 2}
                        fill={fill}
                        opacity={0.15}
                      />
                    ) : (
                      <circle
                        cx={(shapeL + shapeR) / 2}
                        cy={cy}
                        r={dotR + 4}
                        fill={fill}
                        opacity={0.15}
                      />
                    ))}
                  {/* 選取光環 */}
                  {isSelected &&
                    (kind === 'bar' ? (
                      <rect
                        x={shapeL - 3}
                        y={cy - barH / 2 - 3}
                        width={shapeR - shapeL + 6}
                        height={barH + 6}
                        rx={(barH + 6) / 2}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        opacity={0.5}
                      />
                    ) : (
                      <circle
                        cx={(shapeL + shapeR) / 2}
                        cy={cy}
                        r={dotR + 4}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        opacity={0.5}
                      />
                    ))}
                  {kind === 'bar' ? (
                    <rect
                      x={shapeL}
                      y={cy - barH / 2}
                      width={shapeR - shapeL}
                      height={barH}
                      rx={barH / 2}
                      fill={fill}
                      opacity={0.85}
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={dotR} fill={fill} />
                  )}
                  <text
                    x={labelSide === 'right' ? shapeR + 6 : shapeL - 6}
                    y={cy + 4}
                    textAnchor={labelSide === 'right' ? 'start' : 'end'}
                    fontSize={12}
                    fontWeight={isKey ? 700 : 400}
                    fill={isKey ? '#1e293b' : '#334155'}
                  >
                    {dateLabel && <tspan fill="#94a3b8" fontWeight={400}>{dateLabel} </tspan>}
                    {text}
                  </text>
                </g>
              )
            })}
          </g>
        ))}

        {/* 亮起的關係說明標籤：畫在最上層，白底圓角框，不與事件文字交疊 */}
        {showRelations && (
          <g pointerEvents="none">
            {layout.relationLines
              .filter(
                ({ fromKey, toKey }) =>
                  selectedKey === fromKey ||
                  selectedKey === toKey ||
                  hoveredKey === fromKey ||
                  hoveredKey === toKey,
              )
              .map(({ id, label, labelW, labelX, labelY }) => (
                <g key={`${id}-label`}>
                  <rect
                    x={labelX - labelW / 2}
                    y={labelY - 10}
                    width={labelW}
                    height={20}
                    rx={10}
                    fill="#fffbeb"
                    stroke="#f59e0b"
                    strokeWidth={1}
                  />
                  <text
                    x={labelX}
                    y={labelY + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#b45309"
                  >
                    {label}
                  </text>
                </g>
              ))}
          </g>
        )}
      </svg>
    </div>
  )
}
