import { expect, it } from 'vitest'
import { safeFailure } from '../e2e/helpers/networkDiagnostics'
it('includes only a fixed local API path and structured failure, not query credentials', () => {
  expect(safeFailure({url:()=> 'http://127.0.0.1:5273/api/ai/place-photos?key=secret',method:()=> 'POST',failure:()=>({errorText:'net::ERR_NO_BUFFER_SPACE'})}, 3))
    .toEqual({path:'/api/ai/place-photos',method:'POST',error:'net::ERR_NO_BUFFER_SPACE',inFlight:3})
})
it('rejects external, unknown and malformed URLs', () => {
  for(const url of ['https://example.test/api/ai/place-photos','http://127.0.0.1/media/private','broken'])
    expect(safeFailure({url:()=>url,method:()=> 'POST',failure:()=>null}, 0)).toBeNull()
})
it('never publishes arbitrary method or error text', () => {
  expect(safeFailure({url:()=> 'http://127.0.0.1:5273/api/ai/status',method:()=> 'secret',failure:()=>({errorText:'password=secret'})}, 1))
    .toEqual({path:'/api/ai/status',method:'OTHER',error:'unavailable',inFlight:1})
})

it('records the exact component-list route without expanding to item identifiers', () => {
  const request = (path: string) => ({url:()=>`http://127.0.0.1:5273${path}`,method:()=> 'GET',failure:()=>({errorText:'net::ERR_NO_BUFFER_SPACE'})})
  expect(safeFailure(request('/api/components?search=private'), 2)).toEqual({path:'/api/components',method:'GET',error:'net::ERR_NO_BUFFER_SPACE',inFlight:2})
  expect(safeFailure(request('/api/components/private-id'), 2)).toBeNull()
})
