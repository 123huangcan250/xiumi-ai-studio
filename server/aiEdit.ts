import { limitToSelection, selectionScope } from '../src/core/ops'
import type { SelectionPolicy } from '../src/core/types'

/** Only the server's environment selects the policy, never a request or model response. */
export function selectionPolicy(): SelectionPolicy {
  return process.env.AI_SELECTION_POLICY === 'filter' ? 'filter' : 'strict'
}

export function resolveEditSelection(context: any, requestedId?: unknown): string | undefined {
  const hasFocus = context != null && Object.hasOwn(context, 'focus')
  const focusId = context?.focus?.id
  if ((requestedId !== undefined && (typeof requestedId !== 'string' || !requestedId)) ||
      (hasFocus && (typeof focusId !== 'string' || !focusId)) ||
      (hasFocus && requestedId !== undefined && requestedId !== focusId)) {
    throw Object.assign(new Error('无效的选中模块，请重新选择'), { status: 400 })
  }
  const id = requestedId ?? focusId
  if (id !== undefined && !selectionScope(context, id)) {
    throw Object.assign(new Error('选中的模块已不存在，请重新选择'), { status: 400 })
  }
  return id
}

/** Selection is an explicit boundary, not a suggestion the model can ignore. */
export function editPrompt(context: any, instruction: unknown, selectedId?: string, policy: SelectionPolicy = 'strict'): string {
  const id = resolveEditSelection(context, selectedId)
  let scope = '修改范围：全文。'
  if (id) {
    scope = policy === 'filter'
      ? `仅修改选中模块 ${id} 及其子模块：允许 update、remove，或在其顶层位置紧前或紧后 insert（index 以当前文档为准）；框内模块的插入以所在文本框为准。不得修改父模块、兄弟模块、其他模块、主题、文章信息或移动模块。文本框子模块按 id 逐个修改，不得整体替换 children。`
      : `仅修改选中模块 ${id}。其他模块仅供背景参考；只允许对该 id 输出 update 操作，不得修改全文、主题、其他模块或增删移动模块。`
  }
  return `当前文档（模块按顺序排列）：\n${JSON.stringify(context)}\n\n${scope}\n\n用户指令：${String(instruction).slice(0, 2000)}`
}

export function scopeEditResult(result: any, selectedId?: string, context?: any, policy: SelectionPolicy = 'strict'): any {
  const id = resolveEditSelection(context, selectedId)
  if (!Array.isArray(result?.ops)) {
    throw Object.assign(new Error('AI 返回的修改建议格式无效，请重试'), { status: 502 })
  }
  const effectivePolicy = policy === 'filter' ? 'filter' : 'strict'
  const scoped = id ? limitToSelection(context, id, result.ops, effectivePolicy) : { ops: result.ops, dropped: [] }
  if (effectivePolicy === 'strict' && scoped.dropped.length) {
    throw Object.assign(new Error('AI 返回的修改超出选中模块范围，未生成修改建议，请重试或切换到全文模式'), { status: 502 })
  }
  return { ...result, ops: scoped.ops, selectionPolicy: effectivePolicy, ignoredOps: scoped.dropped.length }
}
