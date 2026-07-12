// ui 層：頁面外殼與工具列。
// M2：載入 examples/ 的同婚時間軸範例，交給 render 層畫出來。
import { useMemo, useState } from 'react'
import rawExample from '../../examples/marriage-equality.hst.json?raw'
import { parseHstJson } from '../adapters/json'
import type { ScaleMode, ScaleRequest } from '../render/TimelineView'
import { TimelineView } from '../render/TimelineView'

const SCALE_LABELS: Record<ScaleMode, string> = {
  day: '日',
  week: '週',
  month: '月',
  year: '年',
}

export default function App() {
  const parsed = useMemo(() => parseHstJson(rawExample), [])
  const [scaleRequest, setScaleRequest] = useState<ScaleRequest | null>(null)
  const [activeMode, setActiveMode] = useState<ScaleMode>('year')

  if (!parsed.ok) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-bold text-red-700">範例檔案驗證失敗</h1>
        <ul className="mt-4 list-disc pl-6 text-sm text-slate-700">
          {parsed.errors.map((e, i) => (
            <li key={i}>
              <code className="text-red-600">{e.path}</code>：{e.message}
            </li>
          ))}
        </ul>
      </main>
    )
  }

  const doc = parsed.doc

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-2">
        <h1 className="text-lg font-bold tracking-wide text-slate-800">HackStory</h1>
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-700">{doc.meta.title}</span>
          {doc.meta.subtitle && (
            <span className="ml-2 hidden text-xs text-slate-400 sm:inline">
              {doc.meta.subtitle}
            </span>
          )}
        </div>

        {/* 尺度切換（像 Google 日曆） */}
        <div className="ml-auto flex overflow-hidden rounded-md border border-slate-300">
          {(Object.keys(SCALE_LABELS) as ScaleMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() =>
                setScaleRequest((prev) => ({ mode, nonce: (prev?.nonce ?? 0) + 1 }))
              }
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

      <div className="min-h-0 flex-1">
        <TimelineView doc={doc} scaleRequest={scaleRequest} onScaleModeChange={setActiveMode} />
      </div>

      <footer className="border-t border-slate-200 px-4 py-1.5 text-xs text-slate-400">
        滑鼠滾輪：縮放　｜　按住拖曳：平移　｜　右上按鈕：切換日／週／月／年尺度
      </footer>
    </div>
  )
}
