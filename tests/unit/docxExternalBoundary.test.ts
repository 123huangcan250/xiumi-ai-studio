import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import mammoth from 'mammoth'
import { afterEach, expect, it, vi } from 'vitest'

const assets = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }))
vi.mock('../../server/assets', () => ({ saveAsset: assets.save, deleteAsset: assets.remove }))
import { importFile } from '../../server/importer'

// Use the installed converter's ZIP implementation solely to create fixtures.
const require = createRequire(import.meta.url)
const JSZip = createRequire(require.resolve('mammoth'))('jszip')
const embedded = Buffer.from('synthetic embedded image bytes')
const sentinel = Buffer.from('synthetic local sentinel: must not enter imported assets')
const directories: string[] = []
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

async function documentWithImages(target: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="${relNS}"><Relationship Id="doc" Type="${officeNS}/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${relNS}"><Relationship Id="outside" Type="${officeNS}/image" Target="${xml(target)}" TargetMode="External"/><Relationship Id="inside" Type="${officeNS}/image" Target="media/inside.png"/></Relationships>`)
  const image = (reference: string) => `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="image"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip ${reference}/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${officeNS}" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>Safe document text</w:t></w:r></w:p>${image('r:link="outside"')}${image('r:embed="inside"')}</w:body></w:document>`)
  zip.file('word/media/inside.png', embedded)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function fixture(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-docx-boundary-'))
  directories.push(dir)
  const file = join(dir, 'synthetic-sentinel.png')
  await writeFile(file, sentinel)
  return documentWithImages(pathToFileURL(file).href)
}

afterEach(async () => {
  assets.save.mockReset()
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

it('proves the synthetic external relationship is consumed when explicitly enabled', async () => {
  const read: Buffer[] = []
  const result = await mammoth.convertToHtml({ buffer: await fixture() }, {
    externalFileAccess: true,
    convertImage: mammoth.images.imgElement(async image => {
      read.push(Buffer.from(await image.read('base64'), 'base64'))
      return { src: '/synthetic/image.png' }
    }),
  })
  expect(read).toContainEqual(sentinel)
  expect(read).toContainEqual(embedded)
  expect(result.value).toContain('Safe document text')
})

it('denies the same external relationship while preserving archive image and text', async () => {
  const read: Buffer[] = []
  const result = await mammoth.convertToHtml({ buffer: await fixture() }, {
    externalFileAccess: false,
    convertImage: mammoth.images.imgElement(async image => {
      read.push(Buffer.from(await image.read('base64'), 'base64'))
      return { src: '/synthetic/image.png' }
    }),
  })
  expect(read).toEqual([embedded])
  expect(result.messages.some(message => message.message.includes('external file access is disabled'))).toBe(true)
  expect(result.value).toContain('Safe document text')
})

it('the real application importer never stores external bytes and keeps embedded assets', async () => {
  assets.save.mockImplementation(async (_data, name) => ({ id: 'embedded', file: name }))
  const result = await importFile(await fixture(), 'external-link.docx')
  expect(assets.save).toHaveBeenCalledTimes(1)
  expect(assets.save).toHaveBeenCalledWith(embedded, 'word-image-1.png')
  expect(result.assets).toHaveLength(1)
  expect(result.text).toContain('Safe document text')
  expect(result.text).toContain('/media/word-image-1.png')
  expect(result.text).not.toContain(sentinel.toString())
})

it('does not report a successful import when an embedded image exceeds the resource budget',async()=>{
 assets.save.mockRejectedValue(Object.assign(Error('pixel budget'),{status:413}));
 await expect(importFile(await fixture(),'oversized-image.docx')).rejects.toMatchObject({status:413})
})
it('removes only this failed import\'s successful embedded assets after a later resource error',async()=>{
 const zip=await JSZip.loadAsync(await fixture());const xml=await zip.file('word/document.xml').async('string');zip.file('word/document.xml',xml.replace('</w:body>',xml.slice(xml.indexOf('<w:p><w:r><w:drawing>'),xml.lastIndexOf('</w:body>'))+'</w:body>'))
 assets.save.mockResolvedValueOnce({id:'owned-by-this-import',file:'one.png'}).mockRejectedValueOnce(Object.assign(Error('queue budget'),{status:429}));assets.remove.mockResolvedValue(undefined)
 await expect(importFile(await zip.generateAsync({type:'nodebuffer'}),'images.docx')).rejects.toMatchObject({status:429})
 expect(assets.remove).toHaveBeenCalledExactlyOnceWith('owned-by-this-import')
})
it('keeps the original safety error even when rollback fails',async()=>{
 const zip=await JSZip.loadAsync(await fixture());const xml=await zip.file('word/document.xml').async('string');zip.file('word/document.xml',xml.replace('</w:body>',xml.slice(xml.indexOf('<w:p><w:r><w:drawing>'),xml.lastIndexOf('</w:body>'))+'</w:body>'))
 assets.save.mockResolvedValueOnce({id:'owned',file:'one.png'}).mockRejectedValueOnce(Object.assign(Error('pixel budget'),{status:413}));assets.remove.mockRejectedValue(Error('disk cleanup failed'))
 await expect(importFile(await zip.generateAsync({type:'nodebuffer'}),'cleanup.docx')).rejects.toMatchObject({status:413,cleanupFailures:1})
})
async function repeatedImages(count:number):Promise<Buffer>{
 const zip=await JSZip.loadAsync(await fixture());const xml=await zip.file('word/document.xml').async('string');const end=xml.lastIndexOf('</w:body>'),start=xml.lastIndexOf('<w:p><w:r><w:drawing>');zip.file('word/document.xml',xml.slice(0,xml.indexOf('<w:p><w:r><w:drawing>'))+xml.slice(start,end).repeat(count)+xml.slice(end));return zip.generateAsync({type:'nodebuffer'})
}
it('demonstrates that repeated references cause distinct real converter invocations',async()=>{
 assets.save.mockImplementation(async(_data,name)=>({id:name,file:name,size:10}));const result=await importFile(await repeatedImages(10),'ten.docx');expect(assets.save).toHaveBeenCalledTimes(10);expect(result.assets).toHaveLength(10)
})
it('caps repeated embedded image conversions and rolls back this import at 257',async()=>{
 assets.save.mockImplementation(async(_data,name)=>({id:name,file:name,size:10}));assets.remove.mockResolvedValue(undefined)
 await expect(importFile(await repeatedImages(257),'repeated.docx')).rejects.toMatchObject({status:413});expect(assets.save).toHaveBeenCalledTimes(256);expect(assets.remove).toHaveBeenCalledTimes(256)
},30000)
it('rejects cumulative new-asset output above 128MiB and rolls back every created asset',async()=>{
 assets.save.mockImplementation(async(_data,name)=>({id:name,file:name,size:65*1024*1024}));assets.remove.mockResolvedValue(undefined)
 await expect(importFile(await repeatedImages(3),'output.docx')).rejects.toMatchObject({status:413});expect(assets.save).toHaveBeenCalledTimes(2);expect(assets.remove).toHaveBeenCalledTimes(2)
})
it('preserves exact conversion and output budget boundaries',async()=>{
 assets.save.mockImplementation(async(_data,name)=>({id:name,file:name,size:1}));expect((await importFile(await repeatedImages(256),'boundary-count.docx')).assets).toHaveLength(256)
 assets.save.mockReset();assets.save.mockImplementation(async(_data,name)=>({id:name,file:name,size:64*1024*1024}));expect((await importFile(await repeatedImages(2),'boundary-output.docx')).assets).toHaveLength(2)
})
