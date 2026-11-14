import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({convertToHtml:vi.fn(),saveAsset:vi.fn(),deleteAsset:vi.fn(),imageHandler:undefined as any}))
vi.mock('mammoth',()=>({default:{convertToHtml:mock.convertToHtml,images:{imgElement:(handler:any)=>{mock.imageHandler=handler;return handler}}}}))
vi.mock('../../server/assets',()=>({saveAsset:mock.saveAsset,deleteAsset:mock.deleteAsset}))
import { importFile } from '../../server/importer'
let validDocx: Buffer
beforeEach(async()=>{validDocx=await new JSZip().file('word/document.xml','<document/>').generateAsync({type:'nodebuffer'});vi.resetAllMocks();mock.saveAsset.mockImplementation(async(_data,name)=>({id:name,file:name}))})
describe('Word import file/image boundaries',()=>{
  it('collects embedded images with inferred and declared types and promotes the first paragraph',async()=>{
    mock.convertToHtml.mockImplementation(async()=>{
      const read=vi.fn().mockResolvedValue(Buffer.from('image').toString('base64'))
      expect(await mock.imageHandler({read})).toEqual({src:'/media/word-image-1.png'})
      expect(await mock.imageHandler({read,contentType:'image/jpeg'})).toEqual({src:'/media/word-image-2.jpeg'})
      expect(read).toHaveBeenCalledWith('base64')
      return {value:'<p>Title</p><p>Body</p>'}
    })
    const result=await importFile(validDocx,'SOURCE.DOCX')
    expect(result.text).toBe('# Title\n\nBody');expect(result.assets).toHaveLength(2)
  })
  it('explicitly disables external document file access', async () => {
    mock.convertToHtml.mockResolvedValue({value:'<p>Safe</p>'})
    await importFile(validDocx,'external.docx')
    expect(mock.convertToHtml).toHaveBeenCalledWith({buffer:validDocx}, expect.objectContaining({externalFileAccess:false}))
  })
  it('preserves an existing first-level heading instead of promoting another paragraph',async()=>{
    mock.convertToHtml.mockResolvedValue({value:'<h1>Heading</h1><p>Body</p>'})
    expect((await importFile(validDocx,'source.docx')).text).toBe('# Heading\n\nBody')
  })
  it.each(['end of central directory','Corrupted zip','Invalid zip',"Can't find document",'Could not find file'])('classifies malformed Word content %s',async message=>{
    mock.convertToHtml.mockRejectedValue(Error(message))
    await expect(importFile(validDocx,'source.docx')).rejects.toMatchObject({status:400})
  })
  it('propagates unknown errors instead of falsely labeling every importer failure as corrupt input',async()=>{
    const error=Error('database unavailable');mock.convertToHtml.mockRejectedValueOnce(error)
    await expect(importFile(validDocx,'source.docx')).rejects.toBe(error)
    mock.convertToHtml.mockRejectedValueOnce('unexpected string')
    await expect(importFile(validDocx,'source.docx')).rejects.toBe('unexpected string')
  })
  it.each(['x.txt','x.md','x.markdown'])('strips only leading BOM for %s and rejects unknown formats',async name=>{
    expect(await importFile(Buffer.from('\ufeffhello\ufeff'),name)).toEqual({text:'hello\ufeff',assets:[]})
    await expect(importFile(validDocx,'file.exe')).rejects.toMatchObject({status:400})
  })
})

it('rolls back assets when the converter rejects after an image has been saved',async()=>{
 const failure=Error('conversion failed after image');mock.deleteAsset.mockResolvedValue(undefined);mock.convertToHtml.mockImplementation(async()=>{await mock.imageHandler({read:async()=>Buffer.from('image').toString('base64')});throw failure});
 await expect(importFile(validDocx,'failure.docx')).rejects.toBe(failure);expect(mock.deleteAsset).toHaveBeenCalledExactlyOnceWith('word-image-1.png')
})
it('preserves a primitive converter failure while reporting a failed rollback',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});mock.deleteAsset.mockRejectedValue(Error('cleanup'))
 mock.convertToHtml.mockImplementation(async()=>{await mock.imageHandler({read:async()=>Buffer.from('image').toString('base64')});throw 'converter failed'})
 await expect(importFile(validDocx,'failure.docx')).rejects.toBe('converter failed');expect(warning).toHaveBeenCalledWith('Word import rollback failed for 1 newly created assets');warning.mockRestore()
})
it('waits for already-started image tasks before rolling back an overall conversion rejection',async()=>{
 let finish!:()=>void;mock.saveAsset.mockImplementationOnce(async()=>{await new Promise<void>(resolve=>finish=resolve);return {id:'late-owned',file:'late.png'}});mock.deleteAsset.mockResolvedValue(undefined)
 mock.convertToHtml.mockImplementation(async()=>{void mock.imageHandler({read:async()=>Buffer.from('image').toString('base64')});await new Promise(resolve=>setImmediate(resolve));throw Error('conversion failed')})
 const result=importFile(validDocx,'pending.docx').catch(error=>error);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));finish();expect((await result).message).toBe('conversion failed');expect(mock.deleteAsset).toHaveBeenCalledWith('late-owned')
})
