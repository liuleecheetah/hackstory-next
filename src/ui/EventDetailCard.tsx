// ui 層：事件詳情卡
// 點擊時間軸上的事件後浮出，完整顯示標題、日期、說明、地點、標籤、來源與查證程度。
// 按「編輯事件」切換成表單，可直接修改內容（日期欄吃匯入器支援的所有寫法）；
// 沒有提供 onUpdate 時（例如嵌入模式）為唯讀檢視。

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { AbsoluteTimePoint, Confidence, HstEvent, RelativeAnchor } from '../core'
import { isAbsolute, parseDateTime } from '../core'
import type { EventSelection } from '../render/TimelineView'
import { formatPointLong } from '../render/timeScale'

interface Props {
  selection: EventSelection
  onClose: () => void
  onToggleKey: () => void
  /** 儲存編輯後的事件。未提供時隱藏編輯功能（嵌入模式） */
  onUpdate?: (next: HstEvent) => void
  /** 刪除事件。未提供時隱藏刪除按鈕 */
  onDelete?: () => void
  /** 新增模式：直接開表單，取消＝放棄草稿（關閉卡片） */
  createMode?: boolean
  /** 這個事件的關係清單（含方向與對方標題），由 App 從圖層資料算好傳入 */
  relations?: RelationInfo[]
  /** 刪除一條關係（依文件內的索引） */
  onRemoveRelation?: (index: number) => void
  /** 進入「連結模式」：點選另一個事件建立關係 */
  onStartLink?: () => void
  /** 相對時間下拉選單的選項（同檔案內、排除此事件），由 App 傳入 */
  eventOptions?: Array<{ id: string; title: string }>
}

export interface RelationInfo {
  /** 在文件 relations 陣列中的索引 */
  index: number
  /** out = 此事件指向對方；in = 對方指向此事件 */
  direction: 'out' | 'in'
  typeLabel: string
  label?: string
  otherTitle: string
}

/** 查證程度的中文標籤與配色 */
const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  verified: { label: '已查證', cls: 'bg-green-100 text-green-800' },
  reported: { label: '據報導', cls: 'bg-sky-100 text-sky-800' },
  disputed: { label: '有爭議', cls: 'bg-red-100 text-red-800' },
  unknown: { label: '未查證', cls: 'bg-slate-100 text-slate-600' },
}

/** 結束日期欄的「進行中」寫法（與匯入器一致） */
const RE_ONGOING = /^(至今|迄今|持續中|進行中|now|present|ongoing)$/i

const CARD_W = 340

interface FormState {
  title: string
  startRaw: string
  endRaw: string
  /** 相對時間模式：不填日期，改選「之後／之前」的參考事件 */
  relativeMode: boolean
  afterId: string
  beforeId: string
  description: string
  location: string
  tags: string
  confidence: string
}

export function EventDetailCard({
  selection,
  onClose,
  onToggleKey,
  onUpdate,
  onDelete,
  createMode = false,
  relations = [],
  onRemoveRelation,
  onStartLink,
  eventOptions = [],
}: Props) {
  const { event, docTitle, trackTitle, color, clientX, clientY } = selection

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // 換選不同事件時離開編輯模式；新增模式直接開表單
  useEffect(() => {
    setFormError(null)
    if (createMode) {
      setForm({
        title: event.title,
        startRaw: isAbsolute(event.start) ? (event.start.raw ?? event.start.value) : '',
        endRaw: '',
        relativeMode: false,
        afterId: '',
        beforeId: '',
        description: '',
        location: '',
        tags: '',
        confidence: '',
      })
      setEditing(true)
    } else {
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.key, createMode])

  // 卡片位置：貼著點擊處，水平不出界；點在畫面下半部就往上開
  const style: CSSProperties = {
    width: CARD_W,
    left: Math.min(Math.max(8, clientX + 14), window.innerWidth - CARD_W - 8),
    maxHeight: '64vh',
  }
  if (clientY > window.innerHeight * 0.55) {
    style.bottom = window.innerHeight - clientY + 14
  } else {
    style.top = clientY + 14
  }

  // 日期文字：起（—迄），依精度誠實顯示；進行中事件顯示「至今仍持續」；
  // 相對時間事件顯示先後關係並註明畫面位置只是推估
  const startText = isAbsolute(event.start)
    ? formatPointLong(event.start)
    : `${selection.relativeNote || '相對時間'}（畫面位置為推估）`
  const endText =
    event.end && isAbsolute(event.end)
      ? formatPointLong(event.end)
      : event.ongoing
        ? '至今仍持續'
        : null
  const confidence = event.confidence ? CONFIDENCE[event.confidence] : null
  const isKey = (event.importance ?? 0) >= 5

  const startEdit = () => {
    const relative = isAbsolute(event.start) ? null : (event.start as RelativeAnchor).relative
    setForm({
      title: event.title,
      startRaw: isAbsolute(event.start) ? (event.start.raw ?? event.start.value) : '',
      endRaw:
        event.end && isAbsolute(event.end)
          ? (event.end.raw ?? event.end.value)
          : event.ongoing
            ? '至今'
            : '',
      relativeMode: relative !== null,
      afterId: relative?.after ?? '',
      beforeId: relative?.before ?? '',
      description: event.description ?? '',
      location: event.location?.name ?? '',
      tags: (event.tags ?? []).join(', '),
      confidence: event.confidence ?? '',
    })
    setFormError(null)
    setEditing(true)
  }

  const save = () => {
    if (!form || !onUpdate) return
    const title = form.title.trim()
    if (title === '') {
      setFormError('標題不能空白')
      return
    }

    let start = event.start
    let end: AbsoluteTimePoint | undefined
    let ongoing = false

    if (form.relativeMode) {
      // 相對時間：不填日期，改用「之後／之前」的參考事件（至少一個）
      const after = form.afterId || undefined
      const before = form.beforeId || undefined
      if (!after && !before) {
        setFormError('相對時間至少要選「之後」或「之前」其中一個事件')
        return
      }
      if (after && before && after === before) {
        setFormError('「之後」與「之前」不能是同一個事件')
        return
      }
      start = { relative: { ...(after ? { after } : {}), ...(before ? { before } : {}) } }
      // 相對時間事件是點事件：不帶結束時間與進行中
    } else {
      // 絕對時間：開始日期必填
      let derivedEnd: AbsoluteTimePoint | undefined
      const startRaw = form.startRaw.trim()
      if (startRaw === '') {
        setFormError('開始日期不能空白（不知道日期的話，勾選「改用相對時間」）')
        return
      }
      const parsed = parseDateTime(startRaw)
      if (!parsed.ok) {
        setFormError(`開始日期：${parsed.reason}`)
        return
      }
      start = parsed.start
      derivedEnd = parsed.end // 例如「2016/11/24 09:00-18:00」一格寫完起訖

      // 結束日期：空白＝無、「至今」＝進行中、其他照日期解析
      const endRaw = form.endRaw.trim()
      if (RE_ONGOING.test(endRaw)) {
        ongoing = true
      } else if (endRaw !== '') {
        const parsedEnd = parseDateTime(endRaw)
        if (!parsedEnd.ok) {
          setFormError(`結束日期：${parsedEnd.reason}`)
          return
        }
        end = parsedEnd.start
      } else if (derivedEnd) {
        end = derivedEnd
      }
    }

    const next: HstEvent = { ...event, title, start }
    if (end) next.end = end
    else delete next.end
    if (ongoing) next.ongoing = true
    else delete next.ongoing

    const description = form.description.trim()
    if (description) next.description = description
    else delete next.description

    const locationName = form.location.trim()
    if (locationName) next.location = { ...(event.location ?? {}), name: locationName }
    else delete next.location

    const tags = form.tags.split(/[,、]/).map((t) => t.trim()).filter((t) => t !== '')
    if (tags.length > 0) next.tags = tags
    else delete next.tags

    if (form.confidence) next.confidence = form.confidence as Confidence
    else delete next.confidence

    onUpdate(next)
    setEditing(false)
    setFormError(null)
  }

  const setField = (field: Exclude<keyof FormState, 'relativeMode'>, value: string) =>
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev))

  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1 text-sm'
  const labelCls = 'block text-xs text-slate-500'

  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      style={style}
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <span
          className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h3 className="min-w-0 flex-1 text-sm font-bold leading-snug text-slate-800">
          {editing ? (createMode ? '新增事件' : '編輯事件') : event.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="關閉"
          className="-mr-1 px-1 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      {editing && form ? (
        /* ---- 編輯模式 ---- */
        <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3">
          <label className={labelCls}>
            標題
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={form.relativeMode}
              onChange={(e) =>
                setForm((prev) => (prev ? { ...prev, relativeMode: e.target.checked } : prev))
              }
              className="accent-slate-700"
            />
            改用相對時間（不知道日期，只知道先後順序）
          </label>

          {form.relativeMode ? (
            <div className="flex gap-2">
              <label className={`${labelCls} flex-1`}>
                在這個事件之後
                <select
                  value={form.afterId}
                  onChange={(e) => setField('afterId', e.target.value)}
                  className={inputCls}
                >
                  <option value="">（不設定）</option>
                  {eventOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title.length > 24 ? o.title.slice(0, 24) + '…' : o.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelCls} flex-1`}>
                在這個事件之前
                <select
                  value={form.beforeId}
                  onChange={(e) => setField('beforeId', e.target.value)}
                  className={inputCls}
                >
                  <option value="">（不設定）</option>
                  {eventOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title.length > 24 ? o.title.slice(0, 24) + '…' : o.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="flex gap-2">
              <label className={`${labelCls} flex-1`}>
                開始日期
                <input
                  type="text"
                  value={form.startRaw}
                  onChange={(e) => setField('startRaw', e.target.value)}
                  placeholder="例：2017/5/24"
                  className={inputCls}
                />
              </label>
              <label className={`${labelCls} flex-1`}>
                結束日期
                <input
                  type="text"
                  value={form.endRaw}
                  onChange={(e) => setField('endRaw', e.target.value)}
                  placeholder="空白＝無；至今＝進行中"
                  className={inputCls}
                />
              </label>
            </div>
          )}
          <label className={labelCls}>
            說明
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={4}
              className={inputCls}
            />
          </label>
          <div className="flex gap-2">
            <label className={`${labelCls} flex-1`}>
              地點
              <input
                type="text"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={`${labelCls} flex-1`}>
              查證程度
              <select
                value={form.confidence}
                onChange={(e) => setField('confidence', e.target.value)}
                className={inputCls}
              >
                <option value="">未設定</option>
                <option value="verified">已查證</option>
                <option value="reported">據報導</option>
                <option value="disputed">有爭議</option>
                <option value="unknown">未查證</option>
              </select>
            </label>
          </div>
          <label className={labelCls}>
            標籤（逗號分隔）
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setField('tags', e.target.value)}
              className={inputCls}
            />
          </label>

          {formError && <p className="text-xs text-red-600">{formError}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              儲存
            </button>
            <button
              type="button"
              onClick={() => {
                if (createMode) {
                  onClose() // 放棄新增的草稿
                } else {
                  setEditing(false)
                  setFormError(null)
                }
              }}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
          </div>
          <p className="text-xs text-slate-400">
            改動保留在這個圖層裡，記得用「匯出／分享」下載保存。
          </p>
        </div>
      ) : (
        /* ---- 檢視模式 ---- */
        <>
          <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3 text-sm">
            <p className="text-slate-600">
              {startText}
              {endText && ` — ${endText}`}
              {confidence && (
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${confidence.cls}`}>
                  {confidence.label}
                </span>
              )}
            </p>

            {event.description && (
              <p className="whitespace-pre-wrap leading-relaxed text-slate-700">
                {event.description}
              </p>
            )}

            {event.location?.name && (
              <p className="text-slate-500">地點：{event.location.name}</p>
            )}

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={isKey}
                onChange={onToggleKey}
                className="accent-amber-500"
              />
              標示為關鍵事件（在時間軸上放大顯示）
            </label>

            {event.tags && event.tags.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {event.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </p>
            )}

            {(relations.length > 0 || onStartLink) && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">關係</p>
                {relations.length > 0 && (
                  <ul className="space-y-1">
                    {relations.map((r) => (
                      <li key={r.index} className="flex items-start gap-1 text-xs text-slate-600">
                        <span className="min-w-0 flex-1 leading-relaxed">
                          {r.direction === 'out' ? (
                            <>
                              此事件<b className="mx-0.5">{r.typeLabel}</b>「{r.otherTitle}」
                            </>
                          ) : (
                            <>
                              「{r.otherTitle}」<b className="mx-0.5">{r.typeLabel}</b>此事件
                            </>
                          )}
                          {r.label && <span className="text-slate-400">（{r.label}）</span>}
                        </span>
                        {onRemoveRelation && (
                          <button
                            type="button"
                            title="刪除這條關係"
                            onClick={() => onRemoveRelation(r.index)}
                            className="px-1 text-slate-300 hover:text-red-600"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {onStartLink && (
                  <button
                    type="button"
                    onClick={onStartLink}
                    className="mt-1.5 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    ＋ 連到另一個事件
                  </button>
                )}
              </div>
            )}

            {event.sources && event.sources.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">資料來源</p>
                <ul className="space-y-0.5">
                  {event.sources.map((s, i) => (
                    <li key={i} className="truncate text-xs">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-700 underline hover:text-sky-900"
                        >
                          {s.title ?? s.url}
                        </a>
                      ) : (
                        <span className="text-slate-600">{s.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {onUpdate && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2">
              <button
                type="button"
                onClick={startEdit}
                className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                ✎ 編輯事件
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `確定要刪除「${event.title}」嗎？指向它的關係線也會一併移除。`,
                      )
                    ) {
                      onDelete()
                    }
                  }}
                  className="ml-auto px-2 text-xs text-red-500 hover:text-red-700"
                >
                  刪除
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        {docTitle}
        {trackTitle !== docTitle && `｜${trackTitle}`}
      </p>
    </div>
  )
}
