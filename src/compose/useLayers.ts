// compose 層：圖層管理器
// 「圖層」是執行期概念，不存在檔案裡（SPEC 第 1 節）：
// 使用者疊加的每一份 .hst.json 文件是一個圖層，各有顏色、可顯示隱藏、可排序。
// 鐵律：只能呼叫比它低的層（render、adapters、core）。

import { useCallback, useMemo, useRef, useState } from 'react'
import type { HstEvent, Relation, TimelineDocument, Track } from '../core'
import { removeEventFromDocument } from '../core'

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

  // 暫時隱藏的軸線（key = `圖層id/軸線id`）。這是純檢視狀態：
  // 不寫回 .hst.json、不進復原歷史，跟工具列的顯示開關同一種東西，只是細到單一軸線。
  const [hiddenTracks, setHiddenTracks] = useState<Set<string>>(() => new Set())

  /** 暫時隱藏／顯示文件內的某一條軸線 */
  const toggleTrackVisible = useCallback((layerId: string, trackId: string) => {
    setHiddenTracks((prev) => {
      const next = new Set(prev)
      const key = `${layerId}/${trackId}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // ---- 復原／重做 ----
  // 所有修改都經過 mutate：把「修改前」的狀態推進歷史（上限 50 步）。
  // 歷史操作刻意放在 setLayers 的更新函式外面——
  // React 開發模式會把更新函式執行兩次，副作用寫在裡面會重複。
  const layersRef = useRef(layers)
  layersRef.current = layers
  const pastRef = useRef<Layer[][]>([])
  const futureRef = useRef<Layer[][]>([])
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })

  const mutate = useCallback((updater: (prev: Layer[]) => Layer[]) => {
    const prev = layersRef.current
    const next = updater(prev)
    if (next === prev) return
    pastRef.current = [...pastRef.current.slice(-49), prev]
    futureRef.current = []
    layersRef.current = next
    setLayers(next)
    setHistory({ canUndo: true, canRedo: false })
  }, [])

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    const prev = pastRef.current[pastRef.current.length - 1]
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, layersRef.current]
    layersRef.current = prev
    setLayers(prev)
    setHistory({ canUndo: pastRef.current.length > 0, canRedo: true })
  }, [])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const next = futureRef.current[futureRef.current.length - 1]
    futureRef.current = futureRef.current.slice(0, -1)
    pastRef.current = [...pastRef.current, layersRef.current]
    layersRef.current = next
    setLayers(next)
    setHistory({ canUndo: true, canRedo: futureRef.current.length > 0 })
  }, [])

  /** 以瀏覽器草稿整批還原圖層（這個動作本身也可以復原） */
  const restoreLayers = useCallback(
    (saved: Array<Pick<Layer, 'doc' | 'color' | 'visible'>>) => {
      mutate(() =>
        saved.map((s) => {
          const n = counter.current++
          return { id: `layer-${n}-${s.doc.id}`, doc: s.doc, color: s.color, visible: s.visible }
        }),
      )
    },
    [mutate],
  )

  const addLayer = useCallback((doc: TimelineDocument) => {
    mutate((prev) => [...prev, makeLayer(doc)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeLayer = useCallback((id: string) => {
    mutate((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const toggleVisible = useCallback((id: string) => {
    mutate((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)))
  }, [])

  const setColor = useCallback((id: string, color: string) => {
    mutate((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)))
  }, [])

  /**
   * 更改文件內單一軸線的顏色（多軸文件用）。
   * 改的是檔案本身的 tracks[].color，匯出時會一併保存。
   */
  const setTrackColor = useCallback((layerId: string, trackId: string, color: string) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const tracks = l.doc.tracks.map((t) => (t.id === trackId ? { ...t, color } : t))
        return { ...l, doc: { ...l.doc, tracks } }
      }),
    )
  }, [])

  /**
   * 設為／取消「這份時間軸的重點」：記成布林的 featured（SPEC 0.3），
   * 在時間軸上會放大顯示。匯出時會一併保存。
   */
  const setKeyEvent = useCallback((layerId: string, eventId: string, key: boolean) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const events = l.doc.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const next = { ...ev }
          if (key) {
            next.featured = true
          } else {
            delete next.featured
          }
          return next
        })
        return { ...l, doc: { ...l.doc, events } }
      }),
    )
  }, [])

  /** 建立一份全新的空白時間軸（一條「主線」軸、零事件），作為新圖層 */
  const createBlankLayer = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    const doc: TimelineDocument = {
      hackstory: '0.3',
      id: `timeline-${Date.now().toString(36)}`,
      meta: {
        title: '新的時間軸',
        license: 'CC-BY-4.0',
        language: 'zh-TW',
        created: today,
        updated: today,
        revision: 1,
      },
      tracks: [{ id: 'track-1', title: '主線', order: 1 }],
      events: [],
    }
    mutate((prev) => [...prev, makeLayer(doc)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 新增一條軸線到指定圖層 */
  const addTrack = useCallback((layerId: string, title: string) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const order = Math.max(0, ...l.doc.tracks.map((t) => t.order ?? 0)) + 1
        const track: Track = { id: `track-${Date.now().toString(36)}`, title, order }
        return { ...l, doc: { ...l.doc, tracks: [...l.doc.tracks, track] } }
      }),
    )
  }, [])

  /** 重新命名軸線 */
  const renameTrack = useCallback((layerId: string, trackId: string, title: string) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const tracks = l.doc.tracks.map((t) => (t.id === trackId ? { ...t, title } : t))
        return { ...l, doc: { ...l.doc, tracks } }
      }),
    )
  }, [])

  /** 刪除軸線（呼叫端須先確認軸線上沒有事件、且不是最後一條） */
  const removeTrack = useCallback((layerId: string, trackId: string) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const tracks = l.doc.tracks.filter((t) => t.id !== trackId)
        if (tracks.length === 0) return l // 保險：至少留一條（SPEC 要求）
        return { ...l, doc: { ...l.doc, tracks } }
      }),
    )
  }, [])

  /** 新增事件到指定圖層（id 由呼叫端產生）。匯出時會保存 */
  const addEvent = useCallback((layerId: string, event: HstEvent) => {
    mutate((prev) =>
      prev.map((l) =>
        l.id === layerId ? { ...l, doc: { ...l.doc, events: [...l.doc.events, event] } } : l,
      ),
    )
  }, [])

  /** 以編輯後的事件整筆取代（id 與 track 由呼叫端保留）。匯出時會保存 */
  const replaceEvent = useCallback((layerId: string, eventId: string, next: HstEvent) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const events = l.doc.events.map((ev) => (ev.id === eventId ? next : ev))
        return { ...l, doc: { ...l.doc, events } }
      }),
    )
  }, [])

  /**
   * 刪除事件。連鎖影響由 core 的 removeEventFromDocument 處理：
   * 關係線、相對時間參考一併清理，失去所有參考的相對事件連鎖刪除，
   * 保證刪除後的檔案仍通過 SPEC 驗證。
   */
  const removeEvent = useCallback((layerId: string, eventId: string) => {
    mutate((prev) =>
      prev.map((l) =>
        l.id === layerId ? { ...l, doc: removeEventFromDocument(l.doc, eventId).doc } : l,
      ),
    )
  }, [])

  /** 新增一條事件關係（畫面上的關係編輯器用）。匯出時會保存 */
  const addRelation = useCallback((layerId: string, relation: Relation) => {
    mutate((prev) =>
      prev.map((l) =>
        l.id === layerId
          ? { ...l, doc: { ...l.doc, relations: [...(l.doc.relations ?? []), relation] } }
          : l,
      ),
    )
  }, [])

  /** 依索引刪除一條事件關係 */
  const removeRelation = useCallback((layerId: string, index: number) => {
    mutate((prev) =>
      prev.map((l) => {
        if (l.id !== layerId) return l
        const relations = (l.doc.relations ?? []).filter((_, i) => i !== index)
        return { ...l, doc: { ...l.doc, relations } }
      }),
    )
  }, [])

  /** 重新命名圖層：改的是文件的標題（meta.title），匯出時也會帶著新名字 */
  const renameLayer = useCallback((id: string, title: string) => {
    mutate((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, doc: { ...l.doc, meta: { ...l.doc.meta, title } } } : l,
      ),
    )
  }, [])

  /** 往上（-1）或往下（+1）移動一格。圖層順序 = 時間軸上軸線的排列順序 */
  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    mutate((prev) => {
      const i = prev.findIndex((l) => l.id === id)
      const j = i + direction
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  /**
   * 給 render 層畫的資料：只含可見圖層，依面板順序排列。
   * 被暫時隱藏的軸線（連同其事件）在這裡就濾掉——render 層只收到該畫的資料，
   * 完全不需要知道「隱藏」這個概念（分層鐵律）。
   */
  const visibleSources = useMemo(
    () =>
      layers
        .filter((l) => l.visible)
        .map(({ id, doc, color }) => {
          // 這個圖層沒有任何被隱藏的軸線 → 原樣傳下去，保持物件 identity 避免不必要的重算
          const hidden = new Set(
            doc.tracks.map((t) => t.id).filter((tid) => hiddenTracks.has(`${id}/${tid}`)),
          )
          if (hidden.size === 0) return { id, doc, color }
          const tracks = doc.tracks.filter((t) => !hidden.has(t.id))
          const events = doc.events.filter((e) => !hidden.has(e.track))
          return { id, doc: { ...doc, tracks, events }, color }
        })
        // 整份文件的軸線都被隱藏 → 這個圖層暫時不畫
        .filter((s) => s.doc.tracks.length > 0),
    [layers, hiddenTracks],
  )

  return {
    layers,
    visibleSources,
    hiddenTracks,
    toggleTrackVisible,
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
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    restoreLayers,
  }
}
