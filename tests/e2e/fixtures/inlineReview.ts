import { createBlock } from '../../../src/core/blocks'
import { textToRich } from '../../../src/core/richtext'
export const originalText = '这是一篇待审阅的中文文章。读者需要看到完整的原模块，并将它与下方的修改建议逐段比较。原有信息、图片和排版不会在接受建议之前被替换。'
export const secondText = '第二段保留原文，用于核对新增、删除与撤销操作是否只影响指定模块。'
export const suggestedText = '这是一篇经过整理的中文文章。审阅时，红色区域展示完整原稿，绿色区域展示完整建议。只有点击接受，修改才会写入作品；点击拒绝则保留原文，并且每次修改都可以撤销。'
export function inlineReviewBlocks() {
 return [originalText,secondText].map((text,index)=>({...createBlock('paragraph',{content:textToRich(text),align:'left'}),id:index===0?'a':'b'}))
}
