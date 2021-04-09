import { JSDOM } from "jsdom"
import { convertFormElementsToPlainKeyValueObject } from "../utils/dom"
import { resolve } from "url"
import { readFileSync, writeFileSync } from "fs"

import { Response } from "node-fetch"

import { bakedFetch, Fetch } from "../utils/baked-fetch"
import toughCookie from "tough-cookie"

const jarSym = Symbol()

export const createSession = (): Fetch => {
	const jar = (() => {
		try {
			const z = JSON.parse(
				readFileSync("./credentials.json", { encoding: "utf8" })
			)
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
	writeFileSync("./credentials.json", JSON.stringify(sz))
}

const CAMPUS_SQUARE_SSO_ROOT =
	"https://campusweb.office.uec.ac.jp/campusweb/ssologin.do"

export const isLoggedIn = async (fetch: Fetch) => {
	const sso = await fetch(CAMPUS_SQUARE_SSO_ROOT, { credentials: "includes" })
	return new URL(sso.url).hostname === "campusweb.office.uec.ac.jp"
}

const formIn = (
	html: string,
	find: (d: DocumentFragment) => HTMLFormElement
): {
	method: string
	action: string
	values: Record<string, string>
} | null => {
	const fragment = JSDOM.fragment(html)
	const form = find(fragment)
	if (!form) return null
	const values = convertFormElementsToPlainKeyValueObject(form)
	if (!values) throw new Error(`convert 失敗!`)
	return { action: form.action, method: form.method, values }
}

const continueIfRequired = async (
	{ fetch }: { fetch: Fetch },
	current: Response
): Promise<Response> => {
	const form = formIn(
		await current.text(),
		(d) => d.querySelectorAll("form[name=form1]")[0] as HTMLFormElement
	)
	if (!form) return current
	const resp = await fetch(resolve(current.url, form.action), {
		method: form.method,
		body: new URLSearchParams(form.values).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		credentials: "includes",
	})
	return resp
}

const loginByForm = async (
	{ fetch }: { fetch: Fetch },
	current: Response,
	username: string,
	password: string,
	mfaCodePrompt?: () => Promise<number>
) => {
	const form = formIn(await current.text(), (d) => {
		const f = d.querySelectorAll("form")[0]
		if (f.name)
			throw new Error(
				`名前付きのフォームではないはずですが名前がついていました: ${f.name}`
			)
		return f
	})
	if (!form) throw new Error("ログインフォームがありませんでした")
	form.values["j_username"] = username
	form.values["j_password"] = password

	// 1. ログインフォームを埋める
	var resp = await fetch(resolve(current.url, form.action), {
		method: form.method,
		body: new URLSearchParams(form.values).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		credentials: "includes",
	})

	var text = await resp.text()
	const errors = Array.from(
		JSDOM.fragment(text).querySelectorAll(".form-error")
	).map((e) => e.textContent)
	if (errors.length) {
		throw new Error(`フォームからエラーが返されました: ${errors.join(",")}`)
	}

	// 2. MFA を処理する
	if (resp.url.includes("/mfa/MFAuth.php")) {
		if (!mfaCodePrompt) {
			throw new Error("二段階認証が必要です。引数が足りていません")
		}
		const mfaCode = await mfaCodePrompt()
		const fragment = JSDOM.fragment(text)
		const mfaForm = fragment.querySelectorAll("form")[0]
		const mfaInput = convertFormElementsToPlainKeyValueObject(mfaForm, {
			submitName: "login",
		})
		mfaInput["authcode"] = mfaCode.toString(10)
		resp = await fetch(resolve(resp.url, mfaForm.action), {
			method: form.method,
			body: new URLSearchParams(mfaInput).toString(),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			credentials: "includes",
		})
		text = await resp.text()
	}

	// 3. Continue を押せ!
	if (!resp.url.includes("/idp/profile/SAML2/Redirect/SSO")) {
		console.error(text)
		throw new Error("失敗してそう")
	}
	const continueForm = formIn(text, (d) => d.querySelectorAll("form")[0])
	if (!continueForm) throw new Error("continueフォームがありません…")
	resp = await fetch(resolve(current.url, continueForm.action), {
		method: continueForm.method,
		body: new URLSearchParams(continueForm.values).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		credentials: "includes",
	})

	// 4. チェック
	if (new URL(resp.url).hostname !== "campusweb.office.uec.ac.jp") {
		console.error(text)
		throw new Error("なんか失敗しちゃった……")
	}
}

export const login = async (
	fetch: Fetch,
	username: string,
	password: string,
	mfaCodePrompt?: () => Promise<number>
) => {
	const url = new URL(CAMPUS_SQUARE_SSO_ROOT)

	const sso = await fetch(url, {
		credentials: "includes",
	})
	const ssoURL = new URL(sso.url)

	if (ssoURL.hostname !== "shibboleth.cc.uec.ac.jp") {
		throw new Error(
			"shibboleth にリダイレクトされませんでした。もうログイン済みかもしれません"
		)
	}

	var resp: Response = sso

	// 1. Continue が必要なら行う
	resp = await continueIfRequired({ fetch }, resp)
	// 2. ログイン処理を行う
	await loginByForm({ fetch }, resp, username, password, mfaCodePrompt)
}
