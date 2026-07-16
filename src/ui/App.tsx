// ui 層：頁面外殼與工具列。
// 預設載入「科幻小說的預言」與「現實世界的實現」兩份範本作為兩個圖層，
// 展示多圖層對比；左側面板可顯示隱藏、排序、改配色，也能載入更多 .hst.json。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import rawScifiVsReality from '../../examples/scifi-vs-reality.hst.json?raw'
import { parseHstJson } from '../adapters/json'
import { loadFromUrl } from '../adapters/remote'
import type { HstEvent, Relation, RelationType, RelativeAnchor } from '../core'
import { isAbsolute, parseDateTime } from '../core'
import { useLayers } from '../compose/useLayers'
import type {
  EventSelection,
  NewEventDraft,
  ScaleMode,
  ScaleRequest,
} from '../render/TimelineView'
import { TimelineView } from '../render/TimelineView'
import type { RelationInfo } from './EventDetailCard'
import { EventDetailCard } from './EventDetailCard'
import { ExportDialog } from './ExportDialog'
import { RelationDialog } from './RelationDialog'
import { ImportDialog } from './ImportDialog'
import { LayerPanel } from './LayerPanel'

/** 關係類型的中文名稱 */
const REL_TYPE_LABELS: Record<string, string> = {
  causes: '導致',
  responds_to: '回應',
  derives_from: '衍生自',
  contradicts: '與之矛盾',
  same_event: '同一事件',
}

const SCALE_LABELS: Record<ScaleMode, string> = {
  day: '日',
  week: '週',
  month: '月',
  year: '年',
}

// 分享連結：網址帶 ?src=公開網址 時，載入分享的時間軸（可多個），不載入預設範例
const SHARED_SRC_URLS = new URLSearchParams(window.location.search).getAll('src')

// 預載的範例（模組載入時解析一次）：科幻與現實兩條軸在同一份文件裡，
// 事件之間的 relations 會畫成關係線
const INITIAL_RESULTS =
  SHARED_SRC_URLS.length > 0 ? [] : [rawScifiVsReality].map((raw) => parseHstJson(raw))
const INITIAL_DOCS = INITIAL_RESULTS.flatMap((r) => (r.ok ? [r.doc] : []))
const INITIAL_ERRORS = INITIAL_RESULTS.flatMap((r) =>
  r.ok ? [] : r.errors.map((e) => `內建範例載入失敗 ${e.path}：${e.message}`),
)

export default function App() {
  const {
    layers,
    visibleSources,
    addLayer,
    removeLayer,
    toggleVisible,
    setColor,
    setTrackColor,
    moveLayer,
    renameLayer,
    setKeyEvent,
    addEvent,
    replaceEvent,
    removeEvent,
    addRelation,
    removeRelation,
    createBlankLayer,
    addTrack,
    renameTrack,
    removeTrack,
  } = useLayers(INITIAL_DOCS)
  const [loadErrors, setLoadErrors] = useState<string[]>(INITIAL_ERRORS)
  const [scaleRequest, setScaleRequest] = useState<ScaleRequest | null>(null)
  const [activeMode, setActiveMode] = useState<ScaleMode>('year')
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [showDates, setShowDates] = useState(true)
  const [showYears, setShowYears] = useState(true)
  const [showRelations, setShowRelations] = useState(true)
  // 摺疊空白：預設聽第一份文件的 display.collapseGaps 建議（SPEC 第 8 節）
  const [collapseGaps, setCollapseGaps] = useState(
    () => INITIAL_DOCS[0]?.display?.collapseGaps ?? false,
  )

  // 分享連結（?src=）：開啟時依序載入分享的時間軸，
  // 第一份載入成功的文件決定「摺疊空白」的預設值
  const sharedLoadedRef = useRef(false)
  useEffect(() => {
    if (SHARED_SRC_URLS.length === 0 || sharedLoadedRef.current) return
    sharedLoadedRef.current = true
    void (async () => {
      let first = true
      for (const url of SHARED_SRC_URLS) {
        const result = await loadFromUrl(url)
        if (result.ok) {
          addLayer(result.doc)
          if (first) {
            setCollapseGaps(result.doc.display?.collapseGaps ?? false)
            first = false
          }
          if (result.notice) {
            setLoadErrors((prev) => [...prev, result.notice!])
          }
        } else {
          setLoadErrors((prev) => [...prev, result.error])
        }
      }
    })()
  }, [addLayer])
  // 被點選的事件。關閉詳情卡不會清除選取——選取光環與亮起的關係線會留著，
  // 點時間軸空白處才會真正取消選取
  const [selection, setSelection] = useState<EventSelection | null>(null)
  const [cardVisible, setCardVisible] = useState(false)
  // 新增模式：詳情卡是一張尚未加入圖層的草稿
  const [createMode, setCreateMode] = useState(false)
  // 連結模式：從某事件出發，等使用者點選目標事件來建立關係
  const [linking, setLinking] = useState<{
    sourceId: string
    fromId: string
    fromTitle: string
  } | null>(null)
  // 連結模式點到目標後的「建立關係」表單
  const [relationDraft, setRelationDraft] = useState<{
    sourceId: string
    fromId: string
    fromTitle: string
    toId: string
    toTitle: string
    clientX: number
    clientY: number
  } | null>(null)
  // 短暫的提示訊息（例如跨檔案連結被擋下的原因）
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])

  // render 層回報：點了事件 → 選取並開卡；點了空白處 → 全部清除。
  // 連結模式下，點擊改為「挑選關係的目標事件」
  const handleEventSelect = useCallback(
    (sel: EventSelection | null) => {
      if (linking) {
        if (!sel) {
          setLinking(null)
          setCardVisible(true)
          return
        }
        if (sel.sourceId !== linking.sourceId) {
          showNotice('關係只能連結同一份檔案內的事件（跨圖層請先合併成同一份 .hst.json）')
          return
        }
        if (sel.event.id === linking.fromId) {
          showNotice('不能把事件連到自己')
          return
        }
        setRelationDraft({
          sourceId: linking.sourceId,
          fromId: linking.fromId,
          fromTitle: linking.fromTitle,
          toId: sel.event.id,
          toTitle: sel.event.title,
          clientX: sel.clientX,
          clientY: sel.clientY,
        })
        setLinking(null)
        return
      }
      setSelection(sel)
      setCardVisible(sel !== null)
      setCreateMode(false)
    },
    [linking, showNotice],
  )

  // 詳情卡的「＋連到另一個事件」：進入連結模式（先把卡片收起來，方便點目標）
  const handleStartLink = useCallback(() => {
    if (!selection) return
    setLinking({
      sourceId: selection.sourceId,
      fromId: selection.event.id,
      fromTitle: selection.event.title,
    })
    setCardVisible(false)
  }, [selection])

  // 建立關係表單的「建立」
  const handleCreateRelation = useCallback(
    (type: RelationType, label: string) => {
      if (!relationDraft) return
      const relation: Relation = { from: relationDraft.fromId, to: relationDraft.toId, type }
      if (label.trim() !== '') relation.label = label.trim()
      addRelation(relationDraft.sourceId, relation)
      setRelationDraft(null)
      setCardVisible(true) // 回到來源事件的卡片，可看到新關係
    },
    [relationDraft, addRelation],
  )

  // 目前選取事件的關係清單（含方向與對方標題），給詳情卡顯示
  const selectedRelations = useMemo<RelationInfo[]>(() => {
    if (!selection) return []
    const layer = layers.find((l) => l.id === selection.sourceId)
    if (!layer) return []
    const titleOf = (id: string) => layer.doc.events.find((e) => e.id === id)?.title ?? id
    return (layer.doc.relations ?? []).flatMap((r, index): RelationInfo[] => {
      if (r.from === selection.event.id) {
        return [
          {
            index,
            direction: 'out' as const,
            typeLabel: REL_TYPE_LABELS[r.type] ?? r.type,
            label: r.label,
            otherTitle: titleOf(r.to),
          },
        ]
      }
      if (r.to === selection.event.id) {
        return [
          {
            index,
            direction: 'in' as const,
            typeLabel: REL_TYPE_LABELS[r.type] ?? r.type,
            label: r.label,
            otherTitle: titleOf(r.from),
          },
        ]
      }
      return []
    })
  }, [selection, layers])

  const handleRemoveRelation = useCallback(
    (index: number) => {
      if (!selection) return
      removeRelation(selection.sourceId, index)
    },
    [selection, removeRelation],
  )

  // 新增軸線：預設名稱依現有軸線數編號，之後可在面板 ✎ 改名
  const handleAddTrack = useCallback(
    (layerId: string) => {
      const layer = layers.find((l) => l.id === layerId)
      addTrack(layerId, `新軸線 ${(layer?.doc.tracks.length ?? 0) + 1}`)
    },
    [layers, addTrack],
  )

  // 在軸線空白處點兩下 → 以該位置的日期開「新增事件」表單
  const handleEventCreate = useCallback((draft: NewEventDraft) => {
    const parsed = parseDateTime(draft.dateRaw)
    if (!parsed.ok) return
    const event: HstEvent = {
      id: `evt-${Date.now().toString(36)}`,
      track: draft.trackId,
      title: '',
      start: parsed.start,
    }
    setSelection({
      key: `draft/${event.id}`,
      sourceId: draft.sourceId,
      event,
      docTitle: draft.docTitle,
      trackTitle: draft.trackTitle,
      color: draft.color,
      relativeNote: null,
      clientX: draft.clientX,
      clientY: draft.clientY,
    })
    setCardVisible(true)
    setCreateMode(true)
  }, [])

  // 依事件目前的 start 重新產生「在Ａ之後、在Ｂ之前」的說明（編輯後要算新鮮的）
  const relativeNoteFor = useCallback(
    (sourceId: string, ev: HstEvent): string | null => {
      if (isAbsolute(ev.start)) return null
      const layer = layers.find((l) => l.id === sourceId)
      const rel = (ev.start as RelativeAnchor).relative
      const titleOf = (id: string) => layer?.doc.events.find((e) => e.id === id)?.title ?? id
      const parts: string[] = []
      if (rel.after) parts.push(`在「${titleOf(rel.after)}」之後`)
      if (rel.before) parts.push(`在「${titleOf(rel.before)}」之前`)
      return parts.join('、')
    },
    [layers],
  )

  // 新增模式的「儲存」：把草稿加進圖層，然後轉成一般選取狀態
  const handleCreateSave = useCallback(
    (next: HstEvent) => {
      if (!selection) return
      addEvent(selection.sourceId, next)
      setSelection({
        ...selection,
        key: `${selection.sourceId}/${next.id}`,
        event: next,
        relativeNote: relativeNoteFor(selection.sourceId, next),
      })
      setCreateMode(false)
    },
    [selection, addEvent, relativeNoteFor],
  )

  // 相對時間下拉選單的選項：同一份檔案內、排除自己的所有事件
  const eventOptions = useMemo(() => {
    if (!selection) return []
    const layer = layers.find((l) => l.id === selection.sourceId)
    return (layer?.doc.events ?? [])
      .filter((e) => e.id !== selection.event.id)
      .map((e) => ({ id: e.id, title: e.title }))
  }, [selection, layers])

  // 詳情卡上的「標示為關鍵事件」開關：更新圖層資料，也同步更新卡片顯示。
  // 注意：副作用（setKeyEvent 等）不能放進 setSelection 的更新函式裡——
  // React 開發模式會把更新函式執行兩次，副作用就會重複
  const handleToggleKey = useCallback(() => {
    if (!selection) return
    const nextKey = (selection.event.importance ?? 0) < 5
    setKeyEvent(selection.sourceId, selection.event.id, nextKey)
    const event = { ...selection.event }
    if (nextKey) {
      event.importance = 5
    } else {
      delete event.importance
    }
    setSelection({ ...selection, event })
  }, [selection, setKeyEvent])

  // 詳情卡的「儲存編輯」：更新圖層資料，同步更新卡片顯示
  const handleUpdateEvent = useCallback(
    (next: HstEvent) => {
      if (!selection) return
      replaceEvent(selection.sourceId, selection.event.id, next)
      setSelection({
        ...selection,
        event: next,
        relativeNote: relativeNoteFor(selection.sourceId, next),
      })
    },
    [selection, replaceEvent, relativeNoteFor],
  )

  // 詳情卡的「刪除」：移除事件（連同指向它的關係線）並清除選取
  const handleDeleteEvent = useCallback(() => {
    if (!selection) return
    removeEvent(selection.sourceId, selection.event.id)
    setSelection(null)
  }, [selection, removeEvent])

  // Esc 兩段式：第一下關閉詳情卡（保留選取與關係線），第二下取消選取。
  // 新增模式按 Esc 直接放棄草稿
  useEffect(() => {
    if (!selection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (relationDraft) {
        setRelationDraft(null)
        setCardVisible(true)
      } else if (linking) {
        setLinking(null)
        setCardVisible(true)
      } else if (createMode) {
        setSelection(null)
        setCardVisible(false)
        setCreateMode(false)
      } else if (cardVisible) {
        setCardVisible(false)
      } else {
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, cardVisible, createMode, linking, relationDraft])

  // 關閉詳情卡：新增模式＝放棄草稿，一般模式＝保留選取
  const handleCardClose = useCallback(() => {
    if (createMode) {
      setSelection(null)
      setCreateMode(false)
    }
    setCardVisible(false)
  }, [createMode])
  // 嵌入模式（?embed=1）：只顯示乾淨的時間軸，給 iframe 用
  const isEmbed = new URLSearchParams(window.location.search).has('embed')

  // 使用者從檔案挑選器載入 .hst.json：好的變圖層，壞的把原因列出來（不靜默）
  const handleAddFiles = useCallback(
    (files: FileList) => {
      for (const file of Array.from(files)) {
        void file.text().then((text) => {
          const result = parseHstJson(text)
          if (result.ok) {
            addLayer(result.doc)
          } else {
            const first = result.errors[0]
            setLoadErrors((prev) => [
              ...prev,
              `「${file.name}」載入失敗：${first ? `${first.path} ${first.message}` : '格式錯誤'}` +
                (result.errors.length > 1 ? `（共 ${result.errors.length} 個問題）` : ''),
            ])
          }
        })
      }
    },
    [addLayer],
  )

  // 嵌入模式：無面板、無工具列的乾淨檢視（縮放平移、點事件看詳情仍可用）
  if (isEmbed) {
    return (
      <div className="flex h-screen flex-col bg-white">
        <div className="min-h-0 flex-1">
          <TimelineView
            sources={visibleSources}
            collapseGaps={collapseGaps}
            selectedKey={selection?.key ?? null}
            onEventSelect={handleEventSelect}
          />
        </div>
        {selection && cardVisible && (
          <EventDetailCard
            selection={selection}
            onClose={() => setCardVisible(false)}
            onToggleKey={handleToggleKey}
          />
        )}
        {loadErrors.length > 0 && (
          <div className="border-t border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
            {loadErrors.map((msg, i) => (
              <p key={i}>{msg}</p>
            ))}
          </div>
        )}
        <footer className="border-t border-slate-100 px-3 py-1 text-right text-xs text-slate-400">
          以{' '}
          <a
            href={window.location.origin + window.location.pathname}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-slate-600"
          >
            HackStory
          </a>{' '}
          製作
        </footer>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2">
        <h1 className="text-lg font-bold tracking-wide text-slate-800">HackStory</h1>
        <span className="text-xs text-slate-400">
          {layers.length} 個圖層，顯示中 {visibleSources.length} 個
        </span>

        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          匯入 CSV / Google Sheet
        </button>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          匯出／分享
        </button>

        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showDates}
              onChange={(e) => setShowDates(e.target.checked)}
              className="accent-slate-700"
            />
            顯示事件日期
          </label>
          <label
            className={
              'flex items-center gap-1.5 text-sm ' +
              (showDates ? 'text-slate-600' : 'text-slate-300')
            }
          >
            <input
              type="checkbox"
              checked={showYears}
              disabled={!showDates}
              onChange={(e) => setShowYears(e.target.checked)}
              className="accent-slate-700"
            />
            含年份
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showRelations}
              onChange={(e) => setShowRelations(e.target.checked)}
              className="accent-slate-700"
            />
            顯示關係線
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={collapseGaps}
              onChange={(e) => setCollapseGaps(e.target.checked)}
              className="accent-slate-700"
            />
            摺疊空白
          </label>
        </span>

        {/* 尺度切換（像 Google 日曆） */}
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setScaleRequest((prev) => ({ mode, nonce: (prev?.nonce ?? 0) + 1 }))}
              className={
                'px-3 py-1 text-sm transition-colors ' +
                (activeMode === mode
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100')
              }
            >
              {SCALE_LABELS[mode]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <LayerPanel
          layers={layers}
          errors={loadErrors}
          onToggle={toggleVisible}
          onMove={moveLayer}
          onRemove={removeLayer}
          onColor={setColor}
          onTrackColor={setTrackColor}
          onRename={renameLayer}
          onAddFiles={handleAddFiles}
          onCreateBlank={createBlankLayer}
          onAddTrack={handleAddTrack}
          onRenameTrack={renameTrack}
          onRemoveTrack={removeTrack}
        />
        <div className="min-w-0 flex-1">
          <TimelineView
            sources={visibleSources}
            scaleRequest={scaleRequest}
            onScaleModeChange={setActiveMode}
            showDates={showDates}
            showYears={showYears}
            showRelations={showRelations}
            collapseGaps={collapseGaps}
            selectedKey={selection?.key ?? null}
            onEventSelect={handleEventSelect}
            onEventCreate={handleEventCreate}
          />
        </div>
      </div>

      <footer className="border-t border-slate-200 px-4 py-1.5 text-xs text-slate-400">
        滑鼠滾輪：縮放　｜　按住拖曳：平移　｜　點事件：詳情與編輯　｜　雙擊空白處：新增事件　｜　左側面板：管理圖層
      </footer>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={addLayer}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} layers={layers} />
      {selection && cardVisible && (
        <EventDetailCard
          selection={selection}
          onClose={handleCardClose}
          onToggleKey={handleToggleKey}
          onUpdate={createMode ? handleCreateSave : handleUpdateEvent}
          onDelete={createMode ? undefined : handleDeleteEvent}
          createMode={createMode}
          relations={createMode ? [] : selectedRelations}
          onRemoveRelation={createMode ? undefined : handleRemoveRelation}
          onStartLink={createMode ? undefined : handleStartLink}
          eventOptions={eventOptions}
        />
      )}

      {/* 連結模式的提示橫幅 */}
      {linking && (
        <div className="fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow">
          連結模式：點選「{linking.fromTitle.slice(0, 12)}
          {linking.fromTitle.length > 12 && '…'}」要連到的目標事件｜Esc 取消
        </div>
      )}
      {notice && (
        <div className="fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 shadow">
          {notice}
        </div>
      )}

      {/* 建立關係的表單 */}
      {relationDraft && (
        <RelationDialog
          fromTitle={relationDraft.fromTitle}
          toTitle={relationDraft.toTitle}
          clientX={relationDraft.clientX}
          clientY={relationDraft.clientY}
          onCreate={handleCreateRelation}
          onCancel={() => {
            setRelationDraft(null)
            setCardVisible(true)
          }}
        />
      )}
    </div>
  )
}
