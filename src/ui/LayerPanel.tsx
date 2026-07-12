// ui 層：圖層面板
// 顯示／隱藏、重新命名、調整順序、改配色、載入新的 .hst.json 檔案。
// 面板只呈現與轉發操作，圖層邏輯都在 compose 層的 useLayers。

import { useState } from 'react'
import type { Layer } from '../compose/useLayers'

interface Props {
  layers: Layer[]
  /** 載入失敗的訊息（顯示給使用者，不靜默） */
  errors: string[]
  onToggle: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
  onColor: (id: string, color: string) => void
  /** 更改多軸文件內單一軸線的顏色 */
  onTrackColor: (layerId: string, trackId: string, color: string) => void
  onRename: (id: string, title: string) => void
  onAddFiles: (files: FileList) => void
}

export function LayerPanel({
  layers,
  errors,
  onToggle,
  onMove,
  onRemove,
  onColor,
  onTrackColor,
  onRename,
  onAddFiles,
}: Props) {
  // 正在重新命名的圖層與草稿文字
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const commitRename = () => {
    if (editingId && draftTitle.trim() !== '') {
      onRename(editingId, draftTitle.trim())
    }
    setEditingId(null)
  }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-700">圖層</h2>
        <label className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          ＋載入 .hst.json
          <input
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onAddFiles(e.target.files)
              e.target.value = '' // 允許重複選同一個檔案
            }}
          />
        </label>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {layers.map((layer, i) => (
          <li key={layer.id} className="border-b border-slate-100 px-3 py-2">
            <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={() => onToggle(layer.id)}
              title={layer.visible ? '隱藏此圖層' : '顯示此圖層'}
              className="accent-slate-700"
            />
            {/* 多軸文件以各軸線自己的顏色區分，圖層色塊改列在下方的軸線子列 */}
            {layer.doc.tracks.length === 1 && (
              <input
                type="color"
                value={layer.color}
                onChange={(e) => onColor(layer.id, e.target.value)}
                title="更改圖層顏色"
                className="h-6 w-7 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              {editingId === layer.id ? (
                <input
                  autoFocus
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="w-full rounded border border-slate-400 px-1 py-0.5 text-sm"
                />
              ) : (
                <div
                  className={
                    'truncate text-sm ' +
                    (layer.visible ? 'text-slate-800' : 'text-slate-400 line-through')
                  }
                  title={layer.doc.meta.title}
                >
                  {layer.doc.meta.title}
                </div>
              )}
              <div className="text-xs text-slate-400">{layer.doc.events.length} 筆事件</div>
            </div>
            <button
              type="button"
              title="重新命名"
              onClick={() => {
                setEditingId(layer.id)
                setDraftTitle(layer.doc.meta.title)
              }}
              className="px-1 text-xs text-slate-400 hover:text-slate-700"
            >
              ✎
            </button>
            <div className="flex flex-col">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => onMove(layer.id, -1)}
                title="上移"
                className="px-1 text-xs leading-4 text-slate-500 hover:text-slate-800 disabled:opacity-25"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={i === layers.length - 1}
                onClick={() => onMove(layer.id, 1)}
                title="下移"
                className="px-1 text-xs leading-4 text-slate-500 hover:text-slate-800 disabled:opacity-25"
              >
                ▼
              </button>
            </div>
            <button
              type="button"
              onClick={() => onRemove(layer.id)}
              title="移除此圖層"
              className="px-1 text-sm text-slate-400 hover:text-red-600"
            >
              ✕
            </button>
            </div>

            {/* 多軸文件：列出每條軸線，各自可挑顏色 */}
            {layer.doc.tracks.length > 1 && (
              <ul className="mt-1">
                {layer.doc.tracks.map((track) => (
                  <li key={track.id} className="flex items-center gap-2 py-1 pl-6">
                    <input
                      type="color"
                      value={track.color ?? '#64748b'}
                      onChange={(e) => onTrackColor(layer.id, track.id, e.target.value)}
                      title={`更改「${track.title}」軸線的顏色`}
                      className="h-5 w-6 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                      {track.title}
                    </span>
                    <span className="text-xs text-slate-400">
                      {layer.doc.events.filter((ev) => ev.track === track.id).length} 筆
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {layers.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-slate-400">
            還沒有圖層，點右上「＋載入 .hst.json」
          </li>
        )}
      </ul>

      {errors.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errors.map((msg, i) => (
            <p key={i} className="py-0.5">
              {msg}
            </p>
          ))}
        </div>
      )}

      <p className="border-t border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-400">
        每個圖層是一份獨立的 .hst.json 時間軸檔案，疊加起來就能對比不同來源的整理。
      </p>
    </aside>
  )
}
