import {expect,it} from 'vitest'
import JSZip from 'jszip'
import {importFile} from '../../server/importer'
const documentXml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Budget test</w:t></w:r></w:p></w:body></w:document>'
function doc(){return new JSZip().file('word/document.xml',documentXml)}
it('rejects excessive archive entries before conversion',async()=>{
 const z=doc();for(let i=0;i<2049;i++)z.file('unused'+i,'');
 await expect(importFile(await z.generateAsync({type:'nodebuffer'}),'many.docx')).rejects.toMatchObject({status:413})
})
it('rejects actual inflated entry bytes despite small compressed input',async()=>{
 const z=doc().file('unused.bin',Buffer.alloc(33*1024*1024,65));const bytes=await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 expect(bytes.length).toBeLessThan(30*1024*1024);await expect(importFile(bytes,'bomb.docx')).rejects.toMatchObject({status:413})
},30000)
it('preserves ordinary Word text',async()=>{
 const result=await importFile(await doc().generateAsync({type:'nodebuffer'}),'normal.docx');expect(result.text).toContain('Budget test')
})
import { validateDocxArchive } from '../../server/docxBudget'
it('counts cumulative actual output across separate entries',async()=>{
 const z=new JSZip().file('a',Buffer.alloc(80)).file('b',Buffer.alloc(80));const bytes=await z.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 await expect(validateDocxArchive(bytes,{entries:10,entryBytes:100,totalBytes:150})).rejects.toMatchObject({status:413})
 await expect(validateDocxArchive(bytes,{entries:10,entryBytes:80,totalBytes:160})).resolves.toBeUndefined()
})
it('rejects false ZIP declared sizes rather than trusting a small header',async()=>{
 const bytes=await new JSZip().file('a',Buffer.alloc(100000,65)).generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 const central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE(1,central+24)
 await expect(validateDocxArchive(bytes,{entries:10,entryBytes:1000,totalBytes:1000})).rejects.toThrow()
 await expect(importFile(bytes,'deceptive.docx')).rejects.toMatchObject({status:400})
})
it('rejects malformed budgets and archives and can validate a later valid archive',async()=>{
 await expect(validateDocxArchive(Buffer.alloc(0),{entries:0,entryBytes:1,totalBytes:1})).rejects.toThrow(RangeError)
 await expect(validateDocxArchive(Buffer.from('invalid'))).rejects.toThrow()
 await expect(validateDocxArchive(await doc().generateAsync({type:'nodebuffer'}))).resolves.toBeUndefined()
})
it('destroys decompression on budget rejection so a valid later request works',async()=>{
 const bytes=await new JSZip().file('a',Buffer.alloc(500000,65)).generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 await expect(validateDocxArchive(bytes,{entries:1,entryBytes:1000,totalBytes:2000})).rejects.toMatchObject({status:413})
 await expect(validateDocxArchive(await new JSZip().file('a','ok').generateAsync({type:'nodebuffer'}))).resolves.toBeUndefined()
})
it('rejects duplicate central-directory names and unsupported compression safely',async()=>{
 const bytes=await new JSZip().file('a','one').file('b','two').generateAsync({type:'nodebuffer'});
 const first=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])),second=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),first+4)
 const duplicate=Buffer.from(bytes);duplicate[second+46]=97;await expect(validateDocxArchive(duplicate)).rejects.toThrow('duplicate')
 const method=Buffer.from(bytes);method.writeUInt16LE(99,first+10);await expect(validateDocxArchive(method)).rejects.toThrow()
})
