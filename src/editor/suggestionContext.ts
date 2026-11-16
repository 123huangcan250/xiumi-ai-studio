/** Suggestion-only boundary. Preserve text/layout while replacing nested image references.
 * Input comes from aiContext (HTML already becomes text slots); never rewrite the editable doc. */
export function suggestionContext(value: unknown): unknown {
 if(Array.isArray(value))return value.map(suggestionContext)
 if(!value || typeof value!=='object')return value
 const record=value as Record<string,unknown>
 if(typeof record.src==='string')return '[图片]'
 return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,suggestionContext(item)]))
}
