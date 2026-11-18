import { expect, it } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { richToPlain } from '../../src/core/richtext'
import { inlineReviewBlocks, inlineReviewHtml, inlineReviewReplay, originalText, secondText } from '../e2e/fixtures/inlineReview'
it('stores a valid Chinese RichText fixture without triggering repair or rendering literal markup', () => {
 const blocks=inlineReviewBlocks()
 expect(normalizeBlocks(blocks)).toEqual(blocks)
 expect(JSON.stringify(normalizeBlocks(blocks))).toBe(JSON.stringify(blocks))
 expect(blocks.map(block=>richToPlain(block.props.content))).toEqual([originalText,secondText])
 expect(JSON.stringify(blocks)).not.toContain('<p>')
})

it('keeps custom HTML and looping replay fixtures unchanged during actual normalization',()=>{
 const blocks=[inlineReviewHtml('picture','图文原稿','<section><img src="/media/review-height.svg"><p>完整中文长稿</p></section>'),inlineReviewReplay()]
 expect(normalizeBlocks(blocks)).toEqual(blocks)
 expect(JSON.stringify(normalizeBlocks(blocks))).toBe(JSON.stringify(blocks))
})
