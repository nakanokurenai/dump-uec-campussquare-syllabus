import { JSDOM } from 'jsdom'

import { resolve } from 'url'
import { convertFormElementsToPlainKeyValueObject } from '../utils/dom'

import type { Fetch } from '../utils/baked-fetch'

// "時間割コードが不明な場合" の検索フォームの Select の name とその Option の表示文字列のペアで検索できます
// 空白は trim されます
type Option = {
  // 開講所属
  'jikanwariShozokuCode': string,
  // 学期
  'gakkiKubunCode': '前学期' | '後学期',
  // 年次
  'nenji': '1年' | '2年' | '3年' | '4年' | '5年' | '6年' | '7年',
  [K: string]: string
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
  const jikanwariSearchFormInput = convertFormElementsToPlainKeyValueObject(jikanwariSearchForm, {
    selectByOptionInnerText: {
      ...searchOption,
      '_displayCount': '200'
    }
  })

  // FIXME: ページングに対応していない
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
  if (!searchResultTable) throw new Error('table みつからん')

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
  const data = await Promise.all(tables.map(({ 参照 }) => {
    const onclick = 参照.getAttribute('onclick')!
    if (!onclick.startsWith('refer(')) throw new Error(`参照ボタンの onclick が期待と違います: ${onclick}`)
    // eval で呼ばれるやつ
    const refer = (nendo: string, jscd: string, jcd: string, locale: string) => {
      const jikanwariInputForm = searchResultDocument.getElementById('jikanwariInputForm')! as HTMLFormElement
      const jikanwariInputInput = convertFormElementsToPlainKeyValueObject(jikanwariInputForm)
      jikanwariInputInput.nendo = nendo;
      jikanwariInputInput.jikanwariShozokuCode = jscd;
      jikanwariInputInput.jikanwaricd = jcd;
      jikanwariInputInput.locale = locale;
      return session(resolve(searchResult.url, jikanwariInputForm.action), {
        method: jikanwariInputForm.method,
        body: new URLSearchParams(jikanwariInputInput).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        credentials: 'includes',
      })
    }
    // FIXME: 本当は eval 使いたくない
    return (eval(onclick) as Promise<Response>).then(r => r.text())
  }))

  return tables.map(({参照, ...values}, i) => {
    return {
      // TODO: 年情報を足す。検索条件に含めるようにする
      year: 2020,
      digest: values,
      contentHTML: data[i],
    }
  })
}
