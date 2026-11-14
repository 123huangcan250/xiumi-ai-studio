import {expect,it} from 'vitest'
import {providerErrorText,safeProviderError} from '../../server/providerError'
it('handles empty credentials, null input, and short identical representations',()=>{
 expect(providerErrorText(null,'')).toBe('');expect(providerErrorText(12,'')).toBe('12')
 expect(providerErrorText('x x','x')).toBe('*** ***')
})
it('redacts raw, JSON-escaped and URL-encoded representations together',()=>{
 const key='a/"+b';expect(providerErrorText([key,JSON.stringify(key).slice(1,-1),encodeURIComponent(key)].join('|'),key)).toBe('***|***|***')
})
it('retains raw and JSON protection when URI encoding rejects malformed Unicode',()=>{
 const key='x'+String.fromCharCode(0xd800);expect(providerErrorText(key+'|'+JSON.stringify(key).slice(1,-1),key)).toBe('***|***')
})
it('sanitizes diagnostic fields and discards arbitrary payloads',()=>{
 const error=safeProviderError({message:'secret',name:'secretError',code:'secretCode',status:502,stack:'RAW secret',cause:'secret',extra:'secret'},'secret')
 expect(error).toMatchObject({message:'***',name:'***Error',code:'***Code',status:502});expect(error.stack).not.toContain('RAW');expect(error).not.toHaveProperty('cause');expect(error).not.toHaveProperty('extra')
})
it.each([399,600,NaN,Infinity,502.5,'502',null])('does not propagate invalid status %s',status=>{
 expect(safeProviderError({message:'failure',status},'key')).not.toHaveProperty('status')
})
it.each([NaN,Infinity,{},null,undefined])('does not propagate invalid code %s',code=>{
 expect(safeProviderError({message:'failure',code},'key')).not.toHaveProperty('code')
})
it('preserves finite numeric codes and default Error name',()=>{
 expect(safeProviderError({message:'failure',code:42,name:5},'key')).toMatchObject({message:'failure',code:42,name:'Error'})
 expect(safeProviderError(null,'key').message).toBe('')
})
