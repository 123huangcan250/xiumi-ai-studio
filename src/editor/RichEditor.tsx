import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import type { RichText, Theme } from '../core/types'

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
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph'] }),
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
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      underline: e?.isActive('underline') ?? false,
      highlight: e?.isActive('highlight') ?? false,
      bullet: e?.isActive('bulletList') ?? false,
      ordered: e?.isActive('orderedList') ?? false,
      link: e?.isActive('link') ?? false,
    }),
  })
  useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return null
  const c = theme.colors
  const btn = (label: string, active: boolean, run: () => void, title: string) => (
    <button type="button" className={active ? 'on' : ''} title={title} onMouseDown={(e) => (e.preventDefault(), run())}>
      {label}
    </button>
  )
  const chain = () => editor.chain().focus()
  return (
    <div className="rich-editor" onClick={(e) => e.stopPropagation()}>
      <div className="rich-toolbar">
        {btn('B', st?.bold ?? false, () => chain().toggleBold().run(), '加粗（主题色）')}
        {btn('I', st?.italic ?? false, () => chain().toggleItalic().run(), '斜体')}
        {btn('U', st?.underline ?? false, () => chain().toggleUnderline().run(), '下划线')}
        {btn('高亮', st?.highlight ?? false, () => chain().toggleHighlight({ color: c.primarySoft }).run(), '背景高亮')}
        {btn('主色', false, () => chain().setColor(c.primary).run(), '文字设为主题色')}
        {btn('强调色', false, () => chain().setColor(c.accent).run(), '文字设为强调色')}
        {btn('清除', false, () => chain().unsetAllMarks().run(), '清除格式')}
        <span className="sep" />
        {btn('• 列表', st?.bullet ?? false, () => chain().toggleBulletList().run(), '无序列表')}
        {btn('1. 列表', st?.ordered ?? false, () => chain().toggleOrderedList().run(), '有序列表')}
        {btn('居中', false, () => chain().setTextAlign(editor.isActive({ textAlign: 'center' }) ? 'justify' : 'center').run(), '居中/两端对齐')}
        {btn('链接', st?.link ?? false, () => {
          if (editor.isActive('link')) return chain().unsetLink().run()
          const href = prompt('链接地址（非公众号文章链接在微信中会转为文字）')
          if (href) chain().setLink({ href }).run()
        }, '链接')}
        <span className="sep" />
        <button type="button" className="done" onMouseDown={(e) => (e.preventDefault(), onDone())}>完成</button>
      </div>
      <EditorContent
        editor={editor}
        className="rich-content"
        style={{ fontSize: fontSize ?? theme.fontSize, lineHeight: theme.lineHeight, letterSpacing: theme.letterSpacing, color: c.text, ['--strong' as string]: c.primary, ['--gap' as string]: `${theme.paragraphSpacing}px` }}
      />
    </div>
  )
}
