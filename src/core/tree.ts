// 模块树：顶层模块列表 + 大型文本框里的子模块（只有一层，文本框不能嵌套）。
import type { Block } from './types'

export interface Located {
  block: Block
  /** 所在的文本框；顶层模块为 null */
  parent: Block<'box'> | null
  index: number
}

const kidsOf = (b: Block): Block[] | null => (b.type === 'box' ? b.props.children : null)

export function findBlock(blocks: Block[], id: string | null | undefined): Located | null {
  if (!id) return null
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.id === id) return { block: b, parent: null, index: i }
    const kids = kidsOf(b)
    const j = kids ? kids.findIndex((c) => c.id === id) : -1
    if (j >= 0) return { block: kids![j], parent: b as Block<'box'>, index: j }
  }
  return null
}

/** 所有模块，文本框的子模块紧跟在文本框之后 */
export function flatBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...(kidsOf(b) ?? [])])
}

const withKids = (box: Block, children: Block[]) => ({ ...box, props: { ...box.props, children } }) as Block

/** 修改任意一层的模块；没有变化时返回原数组 */
export function updateBlock(blocks: Block[], id: string, fn: (b: Block) => Block): Block[] {
  let changed = false
  const out = blocks.map((b) => {
    if (b.id === id) {
      changed = true
      return fn(b)
    }
    const kids = kidsOf(b)
    if (kids?.some((c) => c.id === id)) {
      changed = true
      return withKids(b, kids.map((c) => (c.id === id ? fn(c) : c)))
    }
    return b
  })
  return changed ? out : blocks
}

export function removeBlockById(blocks: Block[], id: string): Block[] {
  if (blocks.some((b) => b.id === id)) return blocks.filter((b) => b.id !== id)
  return updateParentOf(blocks, id, (kids) => kids.filter((c) => c.id !== id))
}

function updateParentOf(blocks: Block[], childId: string, fn: (kids: Block[]) => Block[]): Block[] {
  return blocks.map((b) => {
    const kids = kidsOf(b)
    return kids?.some((c) => c.id === childId) ? withKids(b, fn(kids)) : b
  })
}

/** 插入到顶层（parentId 为 null）或某个文本框内；文本框不能放进文本框 */
export function insertBlocksAt(blocks: Block[], parentId: string | null, index: number, list: Block[]): Block[] {
  if (!parentId) {
    const out = [...blocks]
    out.splice(Math.max(0, Math.min(out.length, index)), 0, ...list)
    return out
  }
  if (list.some((b) => b.type === 'box')) return blocks
  return blocks.map((b) => {
    if (b.id !== parentId || b.type !== 'box') return b
    const kids = [...b.props.children]
    kids.splice(Math.max(0, Math.min(kids.length, index)), 0, ...list)
    return withKids(b, kids)
  })
}

/** 把模块移到某个位置（同层排序、移入或移出文本框）；index 指移除该模块之后的位置 */
export function moveBlockTo(blocks: Block[], id: string, parentId: string | null, index: number): Block[] {
  const at = findBlock(blocks, id)
  if (!at || (parentId && at.block.type === 'box') || parentId === id) return blocks
  return insertBlocksAt(removeBlockById(blocks, id), parentId, index, [at.block])
}

/** 用几个模块替换一个模块（同一层） */
export function replaceBlockWith(blocks: Block[], id: string, list: Block[]): Block[] {
  const at = findBlock(blocks, id)
  if (!at) return blocks
  const swap = (arr: Block[]) => {
    const out = [...arr]
    out.splice(at.index, 1, ...list)
    return out
  }
  if (!at.parent) return swap(blocks)
  return updateParentOf(blocks, id, (kids) => swap(kids).filter((b) => b.type !== 'box'))
}

/**
 * 点击添加模块时的插入位置：选中大型文本框 → 插到框内末尾；选中框内模块 → 插到它后面（仍在框内）；
 * 文本框不能嵌套，插入文本框时总是放在顶层。
 */
export function insertionPoint(blocks: Block[], selectedId: string | null, isBox: boolean): { parentId: string | null; index: number } {
  const sel = findBlock(blocks, selectedId)
  if (!sel) return { parentId: null, index: blocks.length }
  if (sel.parent) {
    if (!isBox) return { parentId: sel.parent.id, index: sel.index + 1 }
    return { parentId: null, index: blocks.findIndex((b) => b.id === sel.parent!.id) + 1 }
  }
  if (sel.block.type === 'box' && !isBox) return { parentId: sel.block.id, index: sel.block.props.children.length }
  return { parentId: null, index: sel.index + 1 }
}
