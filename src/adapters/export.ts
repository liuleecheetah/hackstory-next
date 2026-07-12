// adapters 層：匯出（.hst.json / SVG / PNG / iframe 嵌入碼）
// 只呼叫 core；不管畫面長怎樣，只負責「把東西變成可下載、可分享的格式」。

import type { TimelineDocument } from '../core'

/**
 * 把文件序列化成 .hst.json 文字。
 * 直接序列化原物件——程式不認識的欄位也會原樣寫回（SPEC 第 10 節的向前相容）。
 */
export function documentToJson(doc: TimelineDocument): string {
  return JSON.stringify(doc, null, 2) + '\n'
}

/** 產生 iframe 嵌入碼 */
export function embedCode(url: string): string {
  return `<iframe src="${url}" width="960" height="600" style="border:1px solid #ddd" title="HackStory 時間軸"></iframe>`
}

/** 把畫面上的 SVG 元素序列化成獨立的 .svg 檔內容（自帶白底與字型設定） */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('font-family', "system-ui, 'Noto Sans TC', 'PingFang TC', sans-serif")
  // 畫面上的白底來自 CSS，存成獨立檔案要自己帶一塊白色背景
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)
  return new XMLSerializer().serializeToString(clone)
}

/** SVG 文字 → PNG 圖檔（scale 預設 2 倍，輸出比較清晰） */
export async function svgToPngBlob(
  svgText: string,
  width: number,
  height: number,
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG 圖片載入失敗'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('瀏覽器不支援 canvas')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG 轉檔失敗'))),
        'image/png',
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 觸發瀏覽器下載 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }))
}
