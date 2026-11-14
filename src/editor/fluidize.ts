// 粘贴导入时把写死的像素尺寸还原成百分比：需要真实排版结果，所以在页面上临时排一次再量。
import { fluidizeTree, sourceColumn } from '../core/fluid'

const REF = 'data-fluid-ref'
const SRC = 'data-fluid-src'

/** 原地改写 root 的内容；来源没有写死宽度时什么都不做。返回改写的元素个数 */
export function fluidizeArticle(root: Element): number {
  const column = sourceColumn(root)
  if (!column) return 0
  column.el.setAttribute(REF, '')
  const host = document.createElement('div')
  host.setAttribute('style', `position: absolute; left: -100000px; top: 0; visibility: hidden; pointer-events: none; width: ${column.width}px; font-size: 16px`)
  host.innerHTML = root.innerHTML
  column.el.removeAttribute(REF)
  // 量尺寸不需要图片内容：先摘掉地址，免得为了量一次去请求整篇的图片
  const imgs = Array.from(host.querySelectorAll('img[src]'))
  for (const img of imgs) {
    img.setAttribute(SRC, img.getAttribute('src')!)
    img.removeAttribute('src')
  }
  document.body.appendChild(host)
  try {
    // 正文栏外面可能还有带内边距的外壳：调整临时容器的宽度，让正文栏的父元素正好和来源一样宽
    const ref = host.querySelector(`[${REF}]`)
    for (let i = 0; ref?.parentElement && i < 3; i++) {
      const cs = getComputedStyle(ref.parentElement)
      const inner = ref.parentElement.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      const diff = column.width - inner
      if (Math.abs(diff) < 0.5) break
      host.style.width = `${host.getBoundingClientRect().width + diff}px`
    }
    ref?.removeAttribute(REF)
    const changed = fluidizeTree(host)
    if (!changed) return 0
    for (const img of imgs) {
      img.setAttribute('src', img.getAttribute(SRC)!)
      img.removeAttribute(SRC)
    }
    root.innerHTML = host.innerHTML
    return changed
  } finally {
    host.remove()
  }
}
