import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import type { RichText, Theme } from '../core/types'
import { ColorPicker } from './ColorPicker'
import { TEXT_FONTS, TEXT_SIZES } from '../core/textTypography'
import './rich-typography.css'

/** A selected range may contain independent mixed font and size attributes. */
function typographyState(editor: Editor | null) {
  const current = editor?.getAttributes('textStyle')
  const state = { fontFamily: (current?.fontFamily as string | undefined) ?? '', fontSize: (current?.fontSize as string | undefined) ?? '', mixedFamily: false, mixedSize: false }
  if (!editor || editor.state.selection.empty) return state
  const families = new Set<string>(), sizes = new Set<string>()
  for (const { $from, $to } of editor.state.selection.ranges) {
    editor.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isText || pos >= $to.pos || pos + node.nodeSize <= $from.pos) return
      const attrs = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs
      families.add(attrs?.fontFamily ?? '')
      sizes.add(attrs?.fontSize ?? '')
    })
  }
  return { ...state, fontFamily: families.values().next().value ?? state.fontFamily, fontSize: sizes.values().next().value ?? state.fontSize, mixedFamily: families.size > 1, mixedSize: sizes.size > 1 }
}

interface Props {
  value: RichText
  theme: Theme
  onChange: (v: RichText) => void
  onDone: () => void
  fontSize?: number
}

/** 正文模块的就地富文本编辑器（tiptap），以结构化 JSON 存储 */
export function RichEditor({ value, theme, onChange, onDone, fontSize }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3] }, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false } }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: value,
    autofocus: 'end',
    onUpdate: ({ editor }) => onChange(editor.getJSON() as RichText),
    editorProps: {
      handleKeyDown: (_v, e) => {
        if (e.key === 'Escape') {
          onDone()
          return true
        }
        return false
      },
    },
  })
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      ...typographyState(e),
      empty: e?.state.selection.empty ?? true,
      align: ['left', 'center', 'right', 'justify'].find((textAlign) => e?.isActive({ textAlign })) ?? 'justify',
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      highlight: e?.isActive('highlight') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      link: e?.isActive('link') ?? false,
      color: (e?.getAttributes('textStyle').color as string | undefined) ?? null,
    }),
  })
  useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return null
  const c = theme.colors
  const btn = (label: string, active: boolean, run: () => void, title: string) => (
    <button type="button" className={active ? 'on' : ''} title={title} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  )
  const chain = () => editor.chain().focus()
  return (
    <div className="rich-editor" onClick={(e) => e.stopPropagation()}>
      <div className="rich-toolbar rich-typography-toolbar">
        <span className="rich-typography-controls" onKeyDown={e => e.stopPropagation()}>
          <label>字体<select aria-label="正文字体" value={st?.mixedFamily ? '__mixed__' : st?.fontFamily ?? ''} onChange={e => e.target.value ? editor.chain().setFontFamily(e.target.value).run() : editor.chain().unsetFontFamily().run()}>
            <option value="">跟随模板</option>
            {st?.mixedFamily && <option value="__mixed__" disabled>混合格式</option>}
            {st?.fontFamily && !TEXT_FONTS.some(f => f.value === st.fontFamily) && <option value={st.fontFamily}>原字体</option>}
            {TEXT_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select></label>
          <label>字号<select aria-label="正文字号" value={st?.mixedSize ? '__mixed__' : st?.fontSize ?? ''} onChange={e => e.target.value ? editor.chain().setFontSize(e.target.value).run() : editor.chain().unsetFontSize().run()}>
            <option value="">模板字号</option>
            {st?.mixedSize && <option value="__mixed__" disabled>混合格式</option>}
            {st?.fontSize && !TEXT_SIZES.some(n => `${n}px` === st.fontSize) && <option value={st.fontSize}>{st.fontSize}</option>}
            {TEXT_SIZES.map(n => <option key={n} value={`${n}px`}>{n}px</option>)}
          </select></label>
          <span className="rich-typography-hint">{st?.empty ? '未选中文字：应用于随后输入' : '仅调整选中文字'}</span>
        </span>
        {btn('B', st?.bold ?? false, () => chain().toggleBold().run(), '加粗（主题色）')}
        {btn('I', st?.italic ?? false, () => chain().toggleItalic().run(), '斜体')}
        {btn('U', st?.underline ?? false, () => chain().toggleUnderline().run(), '下划线')}
        {btn('高亮', st?.highlight ?? false, () => chain().toggleHighlight({ color: c.primarySoft }).run(), '背景高亮')}
        <ColorPicker
          value={st?.color}
          groups={[{ label: '主题色', colors: [{ color: c.primary, label: '主色' }, { color: c.accent, label: '强调色' }, { color: c.text, label: '正文色' }, { color: c.muted, label: '次要文字色' }] }]}
          onPick={(color) => (color ? chain().setColor(color).run() : chain().unsetColor().run())}
          testId="rich-color"
        />
        {btn('清除', false, () => chain().unsetAllMarks().run(), '清除格式')}
        <span className="sep" />
        {btn('• 列表', st?.bullet ?? false, () => chain().toggleBulletList().run(), '无序列表')}
        {btn('1. 列表', st?.ordered ?? false, () => chain().toggleOrderedList().run(), '有序列表')}
        {([['left', '左对齐'], ['center', '居中'], ['right', '右对齐'], ['justify', '两端对齐']] as const).map(([align, label]) => (
          <span key={align}>{btn(label, st?.align === align, () => chain().setTextAlign(align).run(), label)}</span>
        ))}
        {btn('链接', st?.link ?? false, () => {
          if (editor.isActive('link')) return chain().unsetLink().run()
          const href = prompt('链接地址（非公众号文章链接在微信中会转为文字）')
          if (href) chain().setLink({ href }).run()
        }, '链接')}
        <span className="sep" />
        <button type="button" className="done" onMouseDown={(e) => e.preventDefault()} onClick={onDone}>完成</button>
      </div>
      <EditorContent
        editor={editor}
        className="rich-content"
        style={{ fontSize: fontSize ?? theme.fontSize, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, color: c.text, ['--strong' as string]: c.primary, ['--gap' as string]: `${theme.paragraphSpacing}px` }}
      />
    </div>
  )
}
