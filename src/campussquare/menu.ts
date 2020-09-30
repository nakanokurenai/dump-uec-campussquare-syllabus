import { Fetch } from "../utils/baked-fetch"
import { resolve } from 'url'
import { JSDOM } from 'jsdom'
import type * as jsdom from 'jsdom'
import { convertFormElementsToPlainKeyValueObject } from "../utils/dom"
import { drun } from "../utils/defer"

const fetchFrame = async (session: Fetch) => {
  const frame = await session('https://campusweb.office.uec.ac.jp/campusweb/ssologin.do', { credentials: 'includes' })
  if (!((new URL(frame.url)).hostname === 'campusweb.office.uec.ac.jp')) throw new Error('ログインしてから呼び出してください')
  return frame
}

export type Menu = {
  url: string,
  window: jsdom.DOMWindow,
}

// menu は一回しか呼ばないものなので frame の取得をしてしまう
export const fetchMenu = (session: Fetch): Promise<Menu> => drun(async defer => {
  const frame = await fetchFrame(session)
  const frameHTML = await frame.text()
  // menu の URL を探す
  const { window: frameWindow, window: { document: frameDocument } } = new JSDOM(frameHTML)
  defer(() => frameWindow.close())
  const frameSrc = frameDocument.querySelector('frame[name=menu]')!.getAttribute('src')!
  const menuURL = resolve(frame.url, frameSrc)
  const resp = await session(menuURL, { credentials: 'includes' })
  // utf-8
  const { window } = new JSDOM(await resp.text())
  return {
    window,
    url: resp.url,
  }
})

export const fetchFlowByMenu = async (session: Fetch, menu: Menu, flowName: string) => {
  const extractFlowID = (name: string) => {
    const s = menu.window.document.querySelector(`span[title="${name}"]`)
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
    const linkForm = Array.from(menu.window.document.forms).find(f => f.name === 'linkForm')
    if (!linkForm) throw new Error('linkForm が見付かりませんでした. 指定された flowID へ遷移できません')
    const input = convertFormElementsToPlainKeyValueObject(linkForm)
    input._flowId = flowID
    const doURL = resolve(menu.url, linkForm.action)
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
  if (!flowID) throw new Error(`メニュー内に ${flowName} に紐付くパスが存在しません`)
  return getByFlowID(flowID)
}
