import { JSDOM } from 'jsdom'

import { resolve } from 'url'
import { convertFormElementsToPlainKeyValueObject } from '../utils/dom'

import type { Fetch } from '../utils/baked-fetch'

// "時間割コードが不明な場合" の検索フォームの Select の name とその Option の表示文字列のペアで検索できます
// 空白は trim されます
type Option = {
  // 開講所属: 空文字が「指示なし」
  jikanwariShozokuCode?: '指示なし' | string,
  // 学期
  gakkiKubunCode?: '指示なし' | '前学期' | '後学期',
  // 年次
  nenji: '指示なし' | '1年' | '2年' | '3年' | '4年' | '5年' | '6年' | '7年',
}

// シラバスの個別ページにジャンプするためのデータ
export type ReferSyllabus = {
  initForm: () => Record<string, string>,
  digest: Record<string, string>,
  method: string,
  url: string,
  options: {
    nendo: string,
    jikanwariShozokuCode: string,
    jikanwaricd: string,
    locale: string,
  },
}

const parseSearchResultTable = (table: HTMLTableElement) => {
  const headers = Array.from(table.tHead!.rows[0].cells)
  return Array.from(table.tBodies[0].rows).reduce((acc, row) => {
    const cells = Array.from(row.cells).map((c, i) => [headers[i], c])
    const o = cells.reduce(
      (acc, [header, cell]) => {
        const headerText = header.textContent!.replace(/\s+/g, '')
        if (headerText === '参照') {
          return {
            ...acc,
            [headerText]: cell.firstElementChild as HTMLInputElement
          }
        }
        return {
          ...acc,
          [headerText]: cell.textContent!.trim()
        }
      }, {} as any
    )
    return [...acc, o]
  }, [] as (Record<string, string> & { '参照': HTMLInputElement })[])
}
const listReferSyllabusInSearchPage = async function* (session: Fetch, document: Document, url: string, bodyHTML: string = "") {
  const searchResultTable = document.querySelector('table[class=normal]') as HTMLTableElement
  if (!searchResultTable) {
    console.error(bodyHTML)
    const errors = document.getElementsByClassName('error')
    if (errors.length) {
      throw new Error(errors[0].textContent!.trim())
    }
    throw new Error('table みつからん!')
  }
  const tables = parseSearchResultTable(searchResultTable)
  const jikanwariInputForm = document.getElementById('jikanwariInputForm')! as HTMLFormElement
  const jikanwariInputInput = convertFormElementsToPlainKeyValueObject(jikanwariInputForm)
  for (const { 参照, ...digest } of tables) {
    const onclick = 参照.getAttribute('onclick')!
    if (!onclick.startsWith('refer(')) throw new Error(`参照ボタンの onclick が期待と違います: ${onclick}`)
    // eval で呼ばれるやつ
    const refer = (nendo: string, jscd: string, jcd: string, locale: string): ReferSyllabus => {
      const referSyllabus: ReferSyllabus = {
        initForm: () => ({ ...jikanwariInputInput }),
        digest,
        options: {
          nendo,
          jikanwariShozokuCode: jscd,
          jikanwaricd: jcd,
          locale,
        },
        method: jikanwariInputForm.method,
        url: resolve(url, jikanwariInputForm.action),
      }
      return referSyllabus
    }
    // FIXME: 本当は eval 使いたくない
    yield eval(onclick) as ReferSyllabus
    // 検索結果に戻す
    const backButton = Array.from(document.getElementsByTagName('a')).filter(v => v.textContent?.trim() === "検索結果に戻る")
    if (backButton.length) {
      console.log(backButton.length)
      await session(backButton[0].href, { credentials: 'includes' })
    }
  }
}

const fetchMenuByFrameHTML = async (session: Fetch, baseURL: string, frameHTML: string) => {
  // menu の URL を探す
  const { window: { document } } = new JSDOM(frameHTML)
  const frameSrc = document.querySelector('frame[name=menu]')!.getAttribute('src')!
  const menuURL = resolve(baseURL, frameSrc)
  // menu は utf-8
  return session(menuURL, { credentials: 'includes' })
}
const fetchFlowByMenuHTML = async (session: Fetch, baseURL: string, menuHTML: string, flowName: string) => {
  // menu は utf-8
  const { window: { document: menuDocument } } = new JSDOM(menuHTML)

  const extractFlowID = (name: string) => {
    const s = menuDocument.querySelector(`span[title="${name}"]`)
    if (!s) return
    const a = s.parentElement!
    var onclick = a.getAttribute('onclick')
    if (!onclick) return
    if (!onclick.trim().startsWith('moveFunc(')) return
    const flowId = onclick.trim().slice(10).split(',')[0].slice(0, -1)
    console.log(`${name} -> ${flowId}`)
    return flowId
  }
  const getByFlowID = (flowID: string) => {
    const linkForm = Array.from(menuDocument.forms).find(f => f.name === 'linkForm')
    if (!linkForm) throw new Error('linkForm が見付かりませんでした. 指定された flowID へ遷移できません')
    const input = convertFormElementsToPlainKeyValueObject(linkForm)
    input._flowId = flowID
    const doURL = resolve(baseURL, linkForm.action)
    return session(doURL, {
      method: linkForm.method,
      body: new URLSearchParams(input).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'includes',
    })
  }
  const flowID = extractFlowID(flowName)!
  if (!flowID) throw new Error(`メニュー内に ${flowName} に紐付くパスが存在しない`)
  return getByFlowID(flowID)
}

const searchSyllabusSearchForm = async (session: Fetch, baseURL: string, menuHTML: string, options: Record<string, string>) => {
  const syllabusSearchForm = await fetchFlowByMenuHTML(session, baseURL, menuHTML, 'シラバス参照')
  const syllabusSearchFormHTML = await syllabusSearchForm.text()
  const { window: { document: syllabusSearchFormDocument } } = new JSDOM(syllabusSearchFormHTML)

  const jikanwariSearchForm = syllabusSearchFormDocument.getElementById('jikanwariSearchForm')! as HTMLFormElement
  // 検索条件を決定する
  // TODO: option の中身を用いてバリデーションする
  // TODO: フォームの name= が足りてるか確認したい
  const jikanwariSearchFormInput = convertFormElementsToPlainKeyValueObject(jikanwariSearchForm, { selectByOptionInnerText: options })

  return session(resolve(syllabusSearchForm.url, jikanwariSearchForm.action), {
    method: jikanwariSearchForm.method,
    body: new URLSearchParams(jikanwariSearchFormInput).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes',
  })
}

// ReferSyllabus を async yield*
export const search = async function* (session: Fetch, searchOption: Option) {
  const frame = await session('https://campusweb.office.uec.ac.jp/campusweb/ssologin.do', { credentials: 'includes' })
  if (!((new URL(frame.url)).hostname === 'campusweb.office.uec.ac.jp')) throw new Error('ログインしてから呼び出してください')
  const frameHTML = await frame.text()

  // menu を探す
  const menu = await fetchMenuByFrameHTML(session, frame.url, frameHTML)
  const menuHTML = await menu.text()

  /**
   * シラバスを検索!!!!
   */
  // 「ページの有効期限が過ぎています。」などと言われてしまうので、少なくしておきページングを進めるたびに読み直す
  const displayCount = '20'
  const searchResult = await searchSyllabusSearchForm(session, menu.url, menuHTML, {
    // FIXME: 型 :(
    ...(searchOption as any),
    // memo: 「ページの有効期限が過ぎています。」などと言われてしまうので、少なくしておきページングを進めるたびに読み直す
    '_displayCount': displayCount
  })
  const searchResultText = await searchResult.text()
  const { window: { document: searchResultDocument } } = new JSDOM(searchResultText)
  for await (const refer of listReferSyllabusInSearchPage(session, searchResultDocument, searchResult.url, searchResultText)) {
    yield refer
  }

  const parseNextPageUrls = (document: Document) => Array.from(
    Array.from(
      document.body.getElementsByTagName('a')).map(a => a.href).reduce((s, i) => { s.add(i); return s },
      new Set<string>()
    ).keys()
  )

  // ページングを全部取得する
  // 問題として、ページングを取得するためには再度取得しなければならない
  const nextPageCount = parseNextPageUrls(searchResultDocument).length
  for (let i = 0; i < nextPageCount; i++) {
    // 再度検索!!!!!
    // 「ページの有効期限が過ぎています。」などと言われてしまうのでページングを進めるたびに読み直す
    const searchResultAgain = await searchSyllabusSearchForm(session, menu.url, menuHTML, {
      // FIXME: 型
      ...(searchOption as any),
      '_displayCount': displayCount
    })
    const searchResultAgainText = await searchResultAgain.text()
    const { window: { document: searchResultAgainDocument } } = new JSDOM(searchResultAgainText)
    const nextUrls = parseNextPageUrls(searchResultAgainDocument)

    const nextPage = await session(resolve(searchResultAgain.url, nextUrls[i]), { credentials: 'includes' })
    const nextPageHTML = await nextPage.text()
    const { window: { document: nextPageDocument } } = new JSDOM(nextPageHTML)
    for await (const refer of listReferSyllabusInSearchPage(session, nextPageDocument, nextPage.url, nextPageHTML)) {
      yield refer
    }
  }
}

export const fetchSyllabusHTMLByRefer = async (session: Fetch, refer: ReferSyllabus) => {
  const form = { ...refer.initForm(), ...refer.options }
  return session(refer.url, {
    method: refer.method,
    body: new URLSearchParams(form).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes',
  }).then(r => r.text())
}
