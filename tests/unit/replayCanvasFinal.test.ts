// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { compileReplay } from '../../src/core/compiler'
import { replayFinalTimes } from '../../src/core/replay'
import { ReplayCanvasBody } from '../../src/editor/ReplayPreview'

afterEach(()=>vi.restoreAllMocks())
it.each(['tap','auto'] as const)('renders a once-only static canvas copy of %s zero-hold loops without changing export',async trigger=>{
 const block=createBlock('replay');block.props.playback.trigger=trigger;block.props.playback.loop={hold:0}
 const before=structuredClone(block)
 const auto={...block,props:{...block.props,playback:{...block.props.playback,trigger:'auto' as const}}}
 const looping=compileReplay(auto)
 expect(looping.scenes[0].cycle).toBe(replayFinalTimes(auto.props)[0])
 expect(looping.html).toContain('repeatCount="indefinite"')
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 const paused=vi.fn(),seek=vi.fn()
 Object.defineProperty(SVGElement.prototype,'pauseAnimations',{configurable:true,value:paused})
 Object.defineProperty(SVGElement.prototype,'setCurrentTime',{configurable:true,value:seek})
 try {
  await act(async()=>root.render(createElement(ReplayCanvasBody,{block})))
  expect(host.querySelector('.block-html')!.innerHTML).not.toContain('repeatCount="indefinite"')
  expect(paused).toHaveBeenCalled();expect(seek).toHaveBeenCalledWith(replayFinalTimes(auto.props)[0])
  expect(block).toEqual(before);expect(compileReplay(block).html).toContain('repeatCount="indefinite"')
 } finally {await act(async()=>root.unmount());host.remove()}
})
