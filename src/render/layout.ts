// render 層：事件排版
// 同一條軸線內，水平重疊的事件往下疊成多個「車道」（lane），避免糊成一團。

export interface LaneItem {
  left: number
  right: number
}

/**
 * 貪婪車道分配：項目需先依 left 排序。
 * 回傳每個項目的車道編號（0 起算），互相重疊的項目會被分到不同車道。
 */
export function assignLanes(items: LaneItem[], gap = 8): number[] {
  /** 每個車道目前佔用到的最右邊位置 */
  const laneRight: number[] = []
  return items.map((item) => {
    for (let lane = 0; lane < laneRight.length; lane++) {
      if (item.left >= laneRight[lane] + gap) {
        laneRight[lane] = item.right
        return lane
      }
    }
    laneRight.push(item.right)
    return laneRight.length - 1
  })
}

/** 粗估文字寬度（CJK 字全形、拉丁字半形），用來做碰撞排版 */
export function estimateTextWidth(text: string, fontSize = 12): number {
  let w = 0
  for (const ch of text) {
    w += (ch.codePointAt(0) ?? 0) > 0xff ? fontSize : fontSize * 0.55
  }
  return w
}

/** 截斷過長的標題（軸上空間有限，完整標題之後點開看） */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}
