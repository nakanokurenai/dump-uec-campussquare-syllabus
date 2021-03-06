import { Fetch } from "../utils/baked-fetch"
import { resolve } from "url"
import { JSDOM } from "jsdom"
import { convertFormElementsToPlainKeyValueObject } from "../utils/dom"

const fetchFrame = async (session: Fetch) => {
	const frame = await session(
		"https://campusweb.office.uec.ac.jp/campusweb/ssologin.do",
		{ credentials: "includes" }
	)
	if (!(new URL(frame.url).hostname === "campusweb.office.uec.ac.jp"))
		throw new Error("ログインしてから呼び出してください")
	return frame
}

export type Menu = {
	url: string
	fragment: DocumentFragment
}

// menu は一回しか呼ばないものなので frame の取得をしてしまう
export const fetchMenu = async (session: Fetch): Promise<Menu> => {
	const frame = await fetchFrame(session)
	const frameHTML = await frame.text()
	// menu の URL を探す
	// FIXME: なぜか frame を JSDOM.fragment ではパースできず Node が抜け落ちるため、生 JSDOM を使っている
	const {
		window,
		window: { document },
	} = new JSDOM(frameHTML)
	const frameSrc = document
		.querySelector("frame[name=menu]")!
		.getAttribute("src")!
	window.close()
	const menuURL = resolve(frame.url, frameSrc)
	const resp = await session(menuURL, { credentials: "includes" })
	return {
		// menu だけ utf-8、JSDOM が優秀なのでなにも考えなくても動くが Shift-JIS だったりするので気をつける必要がある
		fragment: JSDOM.fragment(await resp.text()),
		url: resp.url,
	}
}

export const fetchFlowByMenu = async (
	session: Fetch,
	menu: Menu,
	flowName: string
) => {
	const extractFlowID = (name: string) => {
		const s = menu.fragment.querySelector(`span[title="${name}"]`)
		if (!s) return
		const a = s.parentElement!
		var onclick = a.getAttribute("onclick")
		if (!onclick) return
		if (!onclick.trim().startsWith("moveFunc(")) return
		const flowId = onclick.trim().slice(10).split(",")[0].slice(0, -1)
		console.log(`${name} -> ${flowId}`)
		return flowId
	}
	const getByFlowID = (flowID: string) => {
		const linkForm = Array.from(
			menu.fragment.querySelectorAll("form")
		).find((f) => f.name === "linkForm")
		if (!linkForm)
			throw new Error(
				"linkForm が見付かりませんでした. 指定された flowID へ遷移できません"
			)
		const input = convertFormElementsToPlainKeyValueObject(linkForm)
		input._flowId = flowID
		const doURL = resolve(menu.url, linkForm.action)
		return session(doURL, {
			method: linkForm.method,
			body: new URLSearchParams(input).toString(),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			credentials: "includes",
		})
	}
	const flowID = extractFlowID(flowName)!
	if (!flowID)
		throw new Error(`メニュー内に ${flowName} に紐付くパスが存在しません`)
	return getByFlowID(flowID)
}
