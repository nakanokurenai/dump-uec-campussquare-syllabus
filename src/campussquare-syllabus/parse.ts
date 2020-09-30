import { JSDOM } from 'jsdom'
import sanitize from 'sanitize-html'
import { drun } from '../utils/defer'

type SyllabusTableTree = {
  frame: HTMLTableElement,
  children: SyllabusTableTree[]
  content?: HTMLTableElement
}

export type SyllabusTree = {
  title: string,
  content: { [key: string]: string } | null,
  // JSON からパースするときにこれがない扱いにしたほうが楽なことがあり optional にしたほうがいいかも…
  children: SyllabusTree[]
}

export const parseSyllabusPageHTML = (html: string) => drun(defer => {
  const { window } = new JSDOM(html)
  defer(() => window.close())
  return parseSyllabusPageDocument(window.document)
})

const parseSyllabusPageDocument = (document: Document) => {
  const syllabusElements = Array.from(document.querySelectorAll('table[class="syllabus-frame"], table[class="syllabus-normal"]')) as HTMLTableElement[]

  // たぶん想定と違うので落とす
  if (syllabusElements.length !== 5) {
    throw new Error('syllabus frame was not 5 :(')
  }

  const frameTree = (list: typeof syllabusElements): SyllabusTableTree => {
    const appendChild = ({ frame, children, ...rest }: SyllabusTableTree, child: SyllabusTableTree) => ({ frame, ...rest, children: [...children, child] })
    return list.slice(1).reduce(
      (acc, f) => f.className === 'syllabus-frame' ?
        appendChild(acc, { frame: f, children: [] }) :
        {
          ...acc,
          children: [...(acc.children.slice(0,-1)), { ...acc.children[acc.children.length-1], content: f }],
        },
      { frame: list[0], children: [], normalTableChildren: [] } as SyllabusTableTree
    )
  }

  const convertContent = (content: HTMLTableElement) => {
    const convertElementToInnerTextLike = (e: Element) => {
      // innerText は JSDOM には実装されていないので代用の実装. 欲しいのは改行情報なので、それだけ取りだそうとしてみる
      const cleaned = sanitize(e.innerHTML, {
        allowedTags: ['br'],
      })
      // sanitize を通すと一度 htmlparser2 を通るので <br> <br/> <br   /> などの表記揺れが全部 <br /> になっている
      // しかし、この挙動はおそらく undocumented なのでもっとまともな方法を探したい
      return cleaned.replace(/<br \/>/g, '\n')
    }
    return Array.from(content.querySelectorAll('th[class="syllabus-prin"] + td'))
      .map(n => ({ key: n.previousElementSibling!.textContent!.trim(), value: convertElementToInnerTextLike(n).trim() }))
      .reduce((acc, kv) => ({ ...acc, [kv.key]: kv.value }), {} as { [K: string]: string })
  }
  const convertSyllabusTableTree = (tree: SyllabusTableTree): SyllabusTree => ({
    title: tree.frame.textContent!.trim(),
    children: tree.children.map(t => convertSyllabusTableTree(t)),
    content: tree.content ? convertContent(tree.content) : null
  })

  const t = frameTree(syllabusElements)
  const r = convertSyllabusTableTree(t)
  return r
}

export const convertSyllabusTreeToMarkdown = ({ content, title, children }: SyllabusTree, depth = 1): string => {
  return `\
${'#'.repeat(depth)} ${title}
${content ? '\n' + Object.entries(content).filter(([,value]) => value.trim()).map(
  ([key, value]) => {
    const padding = '    '
    return (
      `- ${key}\n` +
      `${padding}${value.split('\n').map(c => c.trim().replace(/\s+/g, ' ')).join(`\n${padding}`)}`
    )
  }
).join('\n') : ''}\
${children && children.length ? '\n' + children.map(c => convertSyllabusTreeToMarkdown(c, depth+1)).join('\n') : ''}
`
}
