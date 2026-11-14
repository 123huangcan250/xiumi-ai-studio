import { expect, it } from 'vitest'
import { normalizeBlocks } from '../../src/core/blocks'
import { richToPlain } from '../../src/core/richtext'
import { inlineReviewBlocks, originalText, secondText } from '../e2e/fixtures/inlineReview'
it('stores a valid Chinese RichText fixture without triggering repair or rendering literal markup', () => {
 const blocks=inlineReviewBlocks()
 expect(normalizeBlocks(blocks)).toEqual(blocks)
 expect(blocks.map(block=>richToPlain(block.props.content))).toEqual([originalText,secondText])
 expect(JSON.stringify(blocks)).not.toContain('<p>')
})
