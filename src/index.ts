import * as signin from './signin'
import { JSDOM } from 'jsdom'

import { resolve } from 'url'
import { convertFormElementsToPlainKeyValueObject } from './util'

import { writeFileSync } from 'fs'

const question = (question: string) => new Promise<string>((res, rej) => {
  process.stdout.write(question)
  if (!process.stdin.readable) return rej('not readable.')
  let all: string = ''
  while (process.stdin.read()) {
    process.stdin.readable
  }
  const onData = (chunk: Buffer) => {
    all += chunk
    if (all.includes('\n')) {
      onEnd()
    }
  }
  const onEnd = () => {
    process.stdin.removeListener('data', onData)
    process.stdin.removeListener('end', onEnd)
    res(all.trim())
  }
  process.stdin.on('data', onData)
  process.stdin.on('end', onEnd)
})

const loadEnv = () => {
  const { DUS_USERNAME, DUS_PASSWORD } = process.env
  const env = { DUS_USERNAME, DUS_PASSWORD }
  Object.entries(env).forEach(([k, v]) => {
    if (!v) {
      console.error(`key ${k} is missing`)
      process.exit(1)
    }
  })
  return env as { [K in keyof typeof env]: string }
}

async function main() {
  const env = loadEnv()
  const session = signin.createSession()

  // ログインが必要ならする
  if (!(await signin.isLoggedIn(session))) {
    const mfaPin = await question('You must to sign in. Input your MFA code: ')
    await signin.login(session, env.DUS_USERNAME, env.DUS_PASSWORD, Number.parseInt(mfaPin))
    await signin.exportSession(session)
  }

  const frame = await session('https://campusweb.office.uec.ac.jp/campusweb/ssologin.do', { credentials: 'includes' })
  if (!((new URL(frame.url)).hostname === 'campusweb.office.uec.ac.jp')) return

  const { window: { document } } = new JSDOM(await frame.text())
  const frameSrc = document.querySelector('frame[name=menu]')!.getAttribute('src')!
  console.log(frameSrc)
  const menuURL = resolve(frame.url, frameSrc)
  console.log(menuURL)

  // utf-8
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
    console.dir(linkForm)
    if (!linkForm) return
    const input = convertFormElementsToPlainKeyValueObject(linkForm)
    input._flowId = flowID
    const doURL = resolve(menuURL, linkForm.action)
    console.log(doURL)
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

  if (!syllabusSearchPage) throw new Error('シラバスが……開けねえ')

  const syllabusPageText = await syllabusSearchPage.text()
  const { window: { document: syllabusSearchDocument } } = new JSDOM(syllabusPageText)

  const jikanwariSearchForm = syllabusSearchDocument.getElementById('jikanwariSearchForm')! as HTMLFormElement
  // 検索条件を決定する
  const jikanwariSearchFormInput = convertFormElementsToPlainKeyValueObject(jikanwariSearchForm, {
    selectByOptionInnerText: {
      'nenji': '2年',
      'jikanwariShozokuCode': '情報理工学域夜間主コース',
      'gakkiKubunCode': '前学期',
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

  ;(() => {
    /* export it */
    const exp = tables.map(({参照, ...values}, i) => {
      return {
        ...values,
        content: data[i]
      }
    })
    writeFileSync('./syllabus.json', JSON.stringify(exp, null, 2), {encoding: 'utf8'})
  })()
}

main().catch(e => console.error(e))
