import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({zip:undefined as any}))
vi.mock('yauzl',()=>({fromBuffer:(_buffer:any,_options:any,callback:any)=>callback(null,state.zip)}))
import {validateDocxArchive} from '../../server/docxBudget'
it('closes once and ignores late ZIP events and delayed stream creation after failure',async()=>{
 const zip=Object.assign(new EventEmitter(),{readEntry:vi.fn(),close:vi.fn(),openReadStream:vi.fn()});state.zip=zip
 const result=validateDocxArchive(Buffer.alloc(0));await Promise.resolve();zip.emit('entry',{fileName:'one'})
 const error=Error('reader failure');zip.emit('error',error);zip.emit('entry',{fileName:'late'});zip.emit('error',Error('late error'))
 const stream=new PassThrough();const destroy=vi.spyOn(stream,'destroy');zip.openReadStream.mock.calls[0][1](null,stream)
 await expect(result).rejects.toBe(error);expect(destroy).toHaveBeenCalled();expect(zip.close).toHaveBeenCalledTimes(1);expect(zip.openReadStream).toHaveBeenCalledTimes(1)
})
it('destroys an active inflater and ignores late data and end after the budget is hit',async()=>{
 const stream=new PassThrough(),destroy=vi.spyOn(stream,'destroy');const zip=Object.assign(new EventEmitter(),{readEntry:vi.fn(),close:vi.fn(),openReadStream:vi.fn((_entry,callback)=>callback(null,stream))});state.zip=zip
 const result=validateDocxArchive(Buffer.alloc(0),{entries:2,entryBytes:2,totalBytes:2});await Promise.resolve();zip.emit('entry',{fileName:'one'})
 stream.emit('data',Buffer.from('long'));stream.emit('data',Buffer.from('late'));stream.emit('end')
 await expect(result).rejects.toMatchObject({status:413});expect(destroy).toHaveBeenCalled();expect(zip.close).toHaveBeenCalledTimes(1);expect(zip.readEntry).toHaveBeenCalledTimes(1)
})
