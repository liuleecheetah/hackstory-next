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
  /** 建立空白時間軸（新圖層） */
  onCreateBlank: () => void
  /** 軸線管理 */
  onAddTrack: (layerId: string) => void
  onRenameTrack: (layerId: string, trackId: string, title: string) => void
  onRemoveTrack: (layerId: string, trackId: string) => void
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
  onCreateBlank,
  onAddTrack,
  onRenameTrack,
  onRemoveTrack,
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

  // 正在重新命名的軸線（layerId/trackId）與草稿文字
  const [editingTrack, setEditingTrack] = useState<string | null>(null)
  const [draftTrackTitle, setDraftTrackTitle] = useState('')

  const commitTrackRename = (layerId: string, trackId: string) => {
    if (draftTrackTitle.trim() !== '') {
      onRenameTrack(layerId, trackId, draftTrackTitle.trim())
    }
    setEditingTrack(null)
  }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-bold text-slate-700">圖層</h2>
        <button
          type="button"
          onClick={onCreateBlank}
          className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          ＋空白時間軸
        </button>
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

            {/* 軸線清單：改名、配色（多軸時）、刪除空軸線、新增軸線 */}
            <ul className="mt-1">
              {layer.doc.tracks.map((track) => {
                const multi = layer.doc.tracks.length > 1
                const count = layer.doc.events.filter((ev) => ev.track === track.id).length
                const trackKey = `${layer.id}/${track.id}`
                const removable = multi && count === 0
                return (
                  <li key={track.id} className="flex items-center gap-2 py-1 pl-6">
                    {multi && (
                      <input
                        type="color"
                        value={track.color ?? '#64748b'}
                        onChange={(e) => onTrackColor(layer.id, track.id, e.target.value)}
                        title={`更改「${track.title}」軸線的顏色`}
                        className="h-5 w-6 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                      />
                    )}
                    {editingTrack === trackKey ? (
                      <input
                        autoFocus
                        type="text"
                        value={draftTrackTitle}
                        onChange={(e) => setDraftTrackTitle(e.target.value)}
                        onBlur={() => commitTrackRename(layer.id, track.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitTrackRename(layer.id, track.id)
                          if (e.key === 'Escape') setEditingTrack(null)
                        }}
                        className="min-w-0 flex-1 rounded border border-slate-400 px-1 py-0.5 text-xs"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                        {track.title}
                      </span>
                    )}
                    <button
                      type="button"
                      title="重新命名軸線"
                      onClick={() => {
                        setEditingTrack(trackKey)
                        setDraftTrackTitle(track.title)
                      }}
                      className="px-0.5 text-xs text-slate-400 hover:text-slate-700"
                    >
                      ✎
                    </button>
                    <span className="text-xs text-slate-400">{count} 筆</span>
                    <button
                      type="button"
                      disabled={!removable}
                      title={
                        removable
                          ? '刪除這條軸線'
                          : !multi
                            ? '至少要保留一條軸線'
                            : '軸線上還有事件，無法刪除'
                      }
                      onClick={() => onRemoveTrack(layer.id, track.id)}
                      className="px-0.5 text-xs text-slate-300 hover:text-red-600 disabled:opacity-25 disabled:hover:text-slate-300"
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
              <li className="py-0.5 pl-6">
                <button
                  type="button"
                  onClick={() => onAddTrack(layer.id)}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  ＋ 新增軸線
                </button>
              </li>
            </ul>
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
