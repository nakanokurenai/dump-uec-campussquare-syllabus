import { JSDOM } from 'jsdom'
import { convertFormElementsToPlainKeyValueObject } from '../utils/dom'
import { resolve } from 'url'
import { readFileSync, writeFileSync } from 'fs'

import { bakedFetch, Fetch } from '../utils/baked-fetch'
import toughCookie from "tough-cookie";

const jarSym = Symbol()

export const createSession = (): Fetch => {
  const jar = (() => {
    try {
      const z = JSON.parse(readFileSync('./credentials.json', { encoding: 'utf8' }))
      return toughCookie.CookieJar.deserializeSync(z)
    } catch (e) {
      console.error(e)
      return new toughCookie.CookieJar()
    }
  })()

  const baked = bakedFetch(jar)
  const session: Fetch = (...args) => baked(...args)
  Object.defineProperty(session, jarSym, {
    configurable: false,
    enumerable: false,
    value: jar,
    writable: false,
  })
  return session
}

export const exportSession = async (fetch: Fetch) => {
  const jar: toughCookie.CookieJar = (fetch as any)[jarSym]
  const sz = jar.serializeSync()
  writeFileSync('./credentials.json', JSON.stringify(sz))
}

const CAMPUS_SQUARE_SSO_ROOT = 'https://campusweb.office.uec.ac.jp/campusweb/ssologin.do'

export const isLoggedIn = async (fetch: Fetch) => {
  const sso = await fetch(CAMPUS_SQUARE_SSO_ROOT, { credentials: 'includes' })
  return (new URL(sso.url)).hostname === 'campusweb.office.uec.ac.jp'
}

export const login = async (fetch: Fetch, username: string, password: string, mfaCodePrompt?: () => Promise<number>) => {
  const url = new URL(CAMPUS_SQUARE_SSO_ROOT)

  const sso = await fetch(url, {
    credentials: 'includes',
  })

  if ((new URL(sso.url)).hostname !== 'shibboleth.cc.uec.ac.jp') {
    throw new Error('shibboleth にリダイレクトされませんでした。もうログイン済みかもしれません')
  }

  const { window: { document } } = new JSDOM(await sso.text())
  const form = document.forms[0]

  const input = convertFormElementsToPlainKeyValueObject(form)
  input['j_username'] = username
  input['j_password'] = password

  var resp = await fetch(resolve(sso.url, form.action), {
    method: 'post',
    body: new URLSearchParams(input).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes'
  })

  if (resp.url.includes('/mfa/MFAuth.php')) {
    if (!mfaCodePrompt) {
      throw new Error('二段階認証が必要です。引数が足りていません')
    }
    const mfaCode = await mfaCodePrompt()
    const { window: { document } } = new JSDOM(await resp.text())
    const mfaForm = document.forms[0]
    const mfaInput = convertFormElementsToPlainKeyValueObject(mfaForm, { submitName: 'login' })
    mfaInput['authcode'] = mfaCode.toString(10)
    resp = await fetch(resolve(resp.url, mfaForm.action), {
      method: 'post',
      body: new URLSearchParams(mfaInput).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'includes'
    })
  }

  const redirectText = await resp.text()
  if (!resp.url.includes('/idp/profile/SAML2/Redirect/SSO')) {
    console.error(redirectText)
    throw new Error('失敗してそう')
  }

  const { window: { document: redirectDocument } } = new JSDOM(redirectText)
  const redirectForm = redirectDocument.forms[0]
  const redirectResp = await fetch(resolve(resp.url, redirectForm.action), {
    method: 'post',
    body: new URLSearchParams(convertFormElementsToPlainKeyValueObject(redirectForm)).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes'
  })

  if ((new URL(redirectResp.url)).hostname !== 'campusweb.office.uec.ac.jp') {
    console.error(await redirectResp.text())
    throw new Error('なんか失敗しちゃった……')
  }

  return
}
