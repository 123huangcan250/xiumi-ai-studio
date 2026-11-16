/** Preserve legacy url(...) capture semantics with monotone delimiter indexes. Not a CSS sanitizer. */
export function cssImageUrls(text: string): string[] {
  const ends: Array<{close:number;bodyEnd:number}> = []
  const single: Array<{close:number;bodyEnd:number}> = []
  const double: Array<{close:number;bodyEnd:number}> = []
  const breaks: number[] = []
  let whitespaceStart = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/[\r\n\u2028\u2029]/.test(c)) breaks.push(i)
    if (c === ')') {
      const end = {close:i,bodyEnd:whitespaceStart}
      ends.push(end)
      const quote = text[whitespaceStart - 1]
      if (quote === "'") single.push({close:i,bodyEnd:whitespaceStart - 1})
      if (quote === '"') double.push({close:i,bodyEnd:whitespaceStart - 1})
    }
    if (!/\s/.test(c)) whitespaceStart = i + 1
  }
  const positions = {single:0,double:0,end:0,break:0}
  const urls: string[] = []
  let consumed = 0
  for (const match of text.matchAll(/url\(/gi)) {
    if (match.index < consumed) continue
    let start = match.index + 4
    while (start < text.length && /\s/.test(text[start])) start++
    while (positions.break < breaks.length && breaks[positions.break] < start) positions.break++
    const nextBreak = breaks[positions.break] ?? text.length
    const quote = text[start]
    let chosen: {close:number;bodyEnd:number} | undefined
    if (quote === "'" || quote === '"') {
      const kind = quote === "'" ? 'single' : 'double'
      const candidates = kind === 'single' ? single : double
      while (positions[kind] < candidates.length && candidates[positions[kind]].bodyEnd < start + 1) positions[kind]++
      const end = candidates[positions[kind]]
      if (end && end.bodyEnd <= nextBreak) { chosen = end; start++ }
    }
    if (!chosen) {
      while (positions.end < ends.length && ends[positions.end].close < start) positions.end++
      const end = ends[positions.end]
      if (end && Math.max(start,end.bodyEnd) <= nextBreak) chosen = {...end,bodyEnd:Math.max(start,end.bodyEnd)}
    }
    if (chosen) {urls.push(text.slice(start,chosen.bodyEnd));consumed=chosen.close+1}
  }
  return urls
}
