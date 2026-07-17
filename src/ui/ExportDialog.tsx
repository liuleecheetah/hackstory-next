// ui 層：匯出對話框
// 下載各圖層的 .hst.json、把目前畫面存成 SVG / PNG、複製 iframe 嵌入碼。

import { useState } from 'react'
import {
  documentToJson,
  downloadBlob,
  downloadText,
  embedCode,
  serializeSvg,
  svgToPngBlob,
} from '../adapters/export'
import type { Layer } from '../compose/useLayers'

interface Props {
  open: boolean
  onClose: () => void
  layers: Layer[]
  /** 使用者下載了 .hst.json（用來清掉「尚未下載」的提示） */
  onDownloaded?: () => void
}

/** 畫面上時間軸 SVG 的 id（render 層掛的） */
const SVG_ID = 'hackstory-timeline-svg'

export function ExportDialog({ open, onClose, layers, onDownloaded }: Props) {
  const [message, setMessage] = useState<string | null>(null)
  // 分享連結：使用者把 .hst.json 放上公開網址（或用公開試算表）後貼進來
  const [shareSrc, setShareSrc] = useState('')

  if (!open) return null

  const say = (msg: string) => {
    setMessage(msg)
    window.setTimeout(() => setMessage(null), 3000)
  }

  const getSvg = (): SVGSVGElement | null => {
    const svg = document.getElementById(SVG_ID)
    if (!(svg instanceof SVGSVGElement)) {
      say('找不到時間軸畫面——請先確認至少有一個顯示中的圖層')
      return null
    }
    return svg
  }

  const handleSvg = () => {
    const svg = getSvg()
    if (!svg) return
    downloadText('hackstory-timeline.svg', serializeSvg(svg), 'image/svg+xml')
    say('已下載 SVG 圖片')
  }

  const handlePng = () => {
    const svg = getSvg()
    if (!svg) return
    const width = svg.width.baseVal.value
    const height = svg.height.baseVal.value
    void svgToPngBlob(serializeSvg(svg), width, height)
      .then((blob) => {
        downloadBlob('hackstory-timeline.png', blob)
        say('已下載 PNG 圖片')
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  const embedUrl = `${window.location.origin}${window.location.pathname}?embed=1`
  const embedHtml = embedCode(embedUrl)

  const copy = (text: string, what: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => say(`已複製${what}`))
      .catch(() => say('複製失敗——請直接框選文字手動複製'))
  }

  const handleCopyEmbed = () => copy(embedHtml, '嵌入碼')

  // 分享連結與對應的嵌入碼
  const shareBase = `${window.location.origin}${window.location.pathname}`
  const trimmedSrc = shareSrc.trim()
  const shareLink = trimmedSrc ? `${shareBase}?src=${encodeURIComponent(trimmedSrc)}` : ''
  const shareEmbedHtml = trimmedSrc
    ? embedCode(`${shareBase}?embed=1&src=${encodeURIComponent(trimmedSrc)}`)
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-[560px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-bold text-slate-800">匯出與分享</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          {/* .hst.json */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">下載時間軸檔案（.hst.json）</h3>
            <p className="mb-2 text-xs text-slate-400">
              每個圖層是一份可攜的檔案：可以備份、寄給別人、或在這裡重新載入疊加。
            </p>
            <ul className="space-y-1">
              {layers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                    {layer.doc.meta.title}
                    <span className="ml-2 text-xs text-slate-400">
                      {layer.doc.events.length} 筆事件
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      downloadText(
                        `${layer.doc.id}.hst.json`,
                        documentToJson(layer.doc),
                        'application/json',
                      )
                      say(`已下載 ${layer.doc.id}.hst.json`)
                      onDownloaded?.()
                    }}
                    className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    下載
                  </button>
                </li>
              ))}
              {layers.length === 0 && (
                <li className="text-xs text-slate-400">目前沒有圖層</li>
              )}
            </ul>
          </section>

          {/* 分享連結（免後端） */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">分享連結</h3>
            <p className="mb-2 text-xs leading-relaxed text-slate-400">
              把上面下載的 .hst.json 放上任何公開網址（最簡單：GitHub 或 Gist 的 raw
              網址），或直接用「公開的 Google 試算表」網址——貼進下面，就會產生一個開啟即見的分享連結。
            </p>
            <input
              type="url"
              value={shareSrc}
              onChange={(e) => setShareSrc(e.target.value)}
              placeholder="https://raw.githubusercontent.com/... 或 https://docs.google.com/spreadsheets/..."
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            {shareLink && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareLink, '分享連結')}
                    className="shrink-0 rounded bg-slate-800 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
                  >
                    複製連結
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareEmbedHtml}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => copy(shareEmbedHtml, '嵌入碼')}
                    className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    複製嵌入碼
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  想同時分享多份：在連結後面繼續接 <code>&src=另一個網址</code>，開啟時會疊成多個圖層。
                </p>
              </div>
            )}
          </section>

          {/* 圖片 */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">匯出目前畫面為圖片</h3>
            <p className="mb-2 text-xs text-slate-400">
              所見即所得：先在畫面上縮放到想要的範圍，再匯出。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSvg}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                下載 SVG（向量）
              </button>
              <button
                type="button"
                onClick={handlePng}
                className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                下載 PNG（點陣，2 倍解析度）
              </button>
            </div>
          </section>

          {/* iframe */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">嵌入到其他網頁（iframe）</h3>
            <p className="mb-2 text-xs text-slate-400">
              把下面這段貼進部落格或網站的 HTML，就會顯示乾淨的時間軸檢視（部署上線後網址會自動變成正式網址）。
            </p>
            <textarea
              readOnly
              value={embedHtml}
              rows={3}
              onFocus={(e) => e.target.select()}
              className="w-full rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={handleCopyEmbed}
              className="mt-2 rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              複製嵌入碼
            </button>
          </section>

          {message && (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
