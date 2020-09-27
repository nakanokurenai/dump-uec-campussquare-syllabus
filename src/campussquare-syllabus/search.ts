import { JSDOM } from 'jsdom'

import { resolve } from 'url'
import { convertFormElementsToPlainKeyValueObject } from '../utils/dom'

import type { Fetch } from '../utils/baked-fetch'

// "時間割コードが不明な場合" の検索フォームの Select の name とその Option の表示文字列のペアで検索できます
// 空白は trim されます
type Option = {
  // 開講所属: 空文字が「指示なし」
  jikanwariShozokuCode?: string,
  // 学期
  gakkiKubunCode?: '前学期' | '後学期',
  // 年次
  nenji: '1年' | '2年' | '3年' | '4年' | '5年' | '6年' | '7年',
}

// シラバスの個別ページにジャンプするためのデータ
type ReferSyllabus = {
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

// 現時点でページングに非対応なので、検索条件は200件に収まる範囲にしてください
// また、負荷低減手法を取り入れていないため問題があります
export const search = async (session: Fetch, searchOption: Option) => {
  const frame = await session('https://campusweb.office.uec.ac.jp/campusweb/ssologin.do', { credentials: 'includes' })
  if (!((new URL(frame.url)).hostname === 'campusweb.office.uec.ac.jp')) throw new Error('ログインしてから呼び出してください')

  const { window: { document } } = new JSDOM(await frame.text())
  const frameSrc = document.querySelector('frame[name=menu]')!.getAttribute('src')!
  const menuURL = resolve(frame.url, frameSrc)

  // menu は utf-8
  const menu = await session(menuURL, { credentials: 'includes' })
  const { window: { document: menuDocument } } = new JSDOM(await menu.text())

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
    const doURL = resolve(menuURL, linkForm.action)
    return session(doURL, {
      method: linkForm.method,
      body: new URLSearchParams(input).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'includes',
    })
  }

  // シラバス検索ページを開く
  const syllabusID = extractFlowID('シラバス参照')!
  const syllabusSearchPage = await getByFlowID(syllabusID)
  const syllabusPageText = await syllabusSearchPage.text()
  const { window: { document: syllabusSearchDocument } } = new JSDOM(syllabusPageText)

  const jikanwariSearchForm = syllabusSearchDocument.getElementById('jikanwariSearchForm')! as HTMLFormElement
  // 検索条件を決定する
  // TODO: option の中身を用いてバリデーションする
  // TODO: フォームの name= が足りてるか確認したい
  const jikanwariSearchFormInput = convertFormElementsToPlainKeyValueObject(jikanwariSearchForm, {
    selectByOptionInnerText: {
      // FIXME: 型 :(
      ...(searchOption as any),
      '_displayCount': '200'
    }
  })

  const searchResult = await session(resolve(syllabusSearchPage.url, jikanwariSearchForm.action), {
    method: jikanwariSearchForm.method,
    body: new URLSearchParams(jikanwariSearchFormInput).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes',
  })
  const searchResultText = await searchResult.text()
  const { window: { document: searchResultDocument } } = new JSDOM(searchResultText)
  const searchResultTable = searchResultDocument.querySelector('table[class=normal]') as HTMLTableElement
  if (!searchResultTable) {
    const errors = searchResultDocument.getElementsByClassName('error')
    if (errors.length) {
      throw new Error(errors[0].textContent!.trim())
    }
    throw new Error('table みつからん')
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
  const tables = parseSearchResultTable(searchResultTable)
  return tables.map(({ 参照, ...digest }) => {
    const onclick = 参照.getAttribute('onclick')!
    if (!onclick.startsWith('refer(')) throw new Error(`参照ボタンの onclick が期待と違います: ${onclick}`)
    // eval で呼ばれるやつ
    const refer = (nendo: string, jscd: string, jcd: string, locale: string): ReferSyllabus => {
      const jikanwariInputForm = searchResultDocument.getElementById('jikanwariInputForm')! as HTMLFormElement
      const jikanwariInputInput = convertFormElementsToPlainKeyValueObject(jikanwariInputForm)
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
        url: resolve(searchResult.url, jikanwariInputForm.action),
      }
      return referSyllabus
    }
    // FIXME: 本当は eval 使いたくない
    return eval(onclick) as ReferSyllabus
  })
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
