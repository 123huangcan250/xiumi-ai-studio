/** Selection is an explicit boundary, not a suggestion the model can ignore. */
export function editPrompt(context: any, instruction: unknown, selectedId?: string): string {
  if (selectedId) {
    const contains = (blocks: any[]): boolean => blocks.some((b) => b?.id === selectedId || (Array.isArray(b?.props?.children) && contains(b.props.children)))
    if (!Array.isArray(context?.blocks) || !contains(context.blocks)) {
      throw Object.assign(new Error('选中的模块已不存在，请重新选择'), { status: 400 })
    }
  }
  return `当前文档（模块按顺序排列）：\n${JSON.stringify(context)}\n\n${selectedId ? `仅修改选中模块 ${selectedId}。其他模块仅供背景参考；只允许对该 id 输出 update 操作，不得修改全文、主题、其他模块或增删移动模块。` : '修改范围：全文。'}\n\n用户指令：${String(instruction).slice(0, 2000)}`
}

export function scopeEditResult(result: any, selectedId?: string): any {
  if (selectedId && (!Array.isArray(result?.ops) || result.ops.some((op: any) => op?.op !== 'update' || op?.id !== selectedId))) {
    throw Object.assign(new Error('AI 返回的修改超出选中模块范围，未生成修改建议，请重试或切换到全文模式'), { status: 502 })
  }
  return result
}
