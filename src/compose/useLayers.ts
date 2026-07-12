// compose 層：圖層管理器
// 「圖層」是執行期概念，不存在檔案裡（SPEC 第 1 節）：
// 使用者疊加的每一份 .hst.json 文件是一個圖層，各有顏色、可顯示隱藏、可排序。
// 鐵律：只能呼叫比它低的層（render、adapters、core）。

import { useCallback, useMemo, useRef, useState } from 'react'
import type { TimelineDocument } from '../core'

export interface Layer {
  /** 執行期識別碼（同一份文件可被載入多次，所以不能直接用文件 id） */
  id: string
  doc: TimelineDocument
  /** 圖層顏色：疊加時用來辨識「這筆事件來自哪一份文件」，會覆寫文件內的軸線顏色 */
  color: string
  visible: boolean
}

/** 圖層預設輪流使用的顏色 */
const LAYER_PALETTE = ['#3b6ea5', '#d97706', '#0f766e', '#9333ea', '#be123c', '#4d7c0f']

export function useLayers(initialDocs: TimelineDocument[]) {
  // 遞增序號：產生圖層 id 與輪流配色
  const counter = useRef(0)

  const makeLayer = (doc: TimelineDocument): Layer => {
    const n = counter.current++
    return {
      id: `layer-${n}-${doc.id}`,
      doc,
      color: LAYER_PALETTE[n % LAYER_PALETTE.length],
      visible: true,
    }
  }

  // initialDocs 只在第一次渲染時使用
  const [layers, setLayers] = useState<Layer[]>(() => initialDocs.map(makeLayer))

  const addLayer = useCallback((doc: TimelineDocument) => {
    setLayers((prev) => [...prev, makeLayer(doc)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const toggleVisible = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)))
  }, [])

  const setColor = useCallback((id: string, color: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)))
  }, [])

  /**
   * 更改文件內單一軸線的顏色（多軸文件用）。
   * 改的是檔案本身的 tracks[].color，匯出時會一併保存。
   */
  const setTrackColor = useCallback((layerId: string, trackId: string, color: string) => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const tracks = l.doc.tracks.map((t) => (t.id === trackId ? { ...t, color } : t))
        return { ...l, doc: { ...l.doc, tracks } }
      }),
    )
  }, [])

  /**
   * 標示／取消關鍵事件：關鍵事件記成 importance 5（沿用 SPEC 既有欄位，檔案格式不變），
   * 在時間軸上會放大顯示。匯出時會一併保存。
   */
  const setKeyEvent = useCallback((layerId: string, eventId: string, key: boolean) => {
    setLayers((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const events = l.doc.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const next = { ...ev }
          if (key) {
            next.importance = 5
          } else {
            delete next.importance
          }
          return next
        })
        return { ...l, doc: { ...l.doc, events } }
      }),
    )
  }, [])

  /** 重新命名圖層：改的是文件的標題（meta.title），匯出時也會帶著新名字 */
  const renameLayer = useCallback((id: string, title: string) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, doc: { ...l.doc, meta: { ...l.doc.meta, title } } } : l,
      ),
    )
  }, [])

  /** 往上（-1）或往下（+1）移動一格。圖層順序 = 時間軸上軸線的排列順序 */
  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id)
      const j = i + direction
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  /** 給 render 層畫的資料：只含可見圖層，依面板順序排列 */
  const visibleSources = useMemo(
    () => layers.filter((l) => l.visible).map(({ id, doc, color }) => ({ id, doc, color })),
    [layers],
  )

  return {
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
  }
}
