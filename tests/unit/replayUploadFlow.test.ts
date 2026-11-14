// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {prepareXiumiUpload} from '../../src/editor/wechatOutput'
import {createBlock} from '../../src/core/blocks'
import {defaultReplay,makeScene,makeItem} from '../../src/core/replay'
import {emptyDoc} from '../../src/editor/store'
import {api} from '../../src/editor/api'
vi.mock('../../src/editor/api',()=>({api:{replayGlyphs:vi.fn(),wechatUploadImages:vi.fn()}}))
afterEach(()=>vi.clearAllMocks())
it('preflights managed replay images before transferring and accepts only rewritten final output',async()=>{
 const replay=createBlock('replay',{...defaultReplay(),textMode:'svg-text',scenes:[makeScene([makeItem('image',{image:{src:'/media/approved.png'}})])]})
 vi.mocked(api.wechatUploadImages).mockImplementation(async urls=>Object.fromEntries(urls.map(u=>[u,'https://mmbiz.qpic.cn/final.png'])))
 const plan=prepareXiumiUpload({...emptyDoc(),blocks:[replay]});expect(api.wechatUploadImages).not.toHaveBeenCalled()
 expect((await plan.upload()).blob.size).toBeGreaterThan(0);expect(api.wechatUploadImages).toHaveBeenCalledTimes(1)
})
it('rejects foreign replay resources before any upload instead of hiding all replay errors',()=>{
 const replay=createBlock('replay',{...defaultReplay(),textMode:'svg-text',scenes:[makeScene([makeItem('image',{image:{src:'https://other.example/a.png'}})])]})
 expect(()=>prepareXiumiUpload({...emptyDoc(),blocks:[replay]})).toThrow();expect(api.wechatUploadImages).not.toHaveBeenCalled();expect(api.replayGlyphs).not.toHaveBeenCalled()
})

it('rejects an upload mapping that leaves managed local resources in final output',async()=>{
 const replay=createBlock('replay',{...defaultReplay(),textMode:'svg-text',scenes:[makeScene([makeItem('image',{image:{src:'/media/approved.png'}})])]})
 vi.mocked(api.wechatUploadImages).mockImplementation(async urls=>Object.fromEntries(urls.map(u=>[u,u])))
 const plan=prepareXiumiUpload({...emptyDoc(),blocks:[replay]})
 await expect(plan.upload()).rejects.toThrow()
})
it('does not permit arbitrary loopback URLs during source preflight',()=>{
 const replay=createBlock('replay',{...defaultReplay(),textMode:'svg-text',scenes:[makeScene([makeItem('image',{image:{src:'http://localhost:3000/private.png'}})])]})
 expect(()=>prepareXiumiUpload({...emptyDoc(),blocks:[replay]})).toThrow()
 expect(api.wechatUploadImages).not.toHaveBeenCalled()
})
