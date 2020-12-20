import { JSDOM } from "jsdom"
import { resolve } from "url"
import { convertFormElementsToPlainKeyValueObject } from "../utils/dom"
import type { Fetch } from "../utils/baked-fetch"

import { fetchFlowByMenu, fetchMenu, Menu } from "../campussquare/menu"

// "時間割コードが不明な場合" の検索フォームの Select の name とその Option の表示文字列のペアで検索できます
// 空白は trim されます
type Option = {
	// 開講所属: 空文字が「指示なし」
	jikanwariShozokuCode?: "指示なし" | string
	// 学期
	gakkiKubunCode?: "指示なし" | "前学期" | "後学期"
	// 年次
	nenji: "指示なし" | "1年" | "2年" | "3年" | "4年" | "5年" | "6年" | "7年"
}

// シラバスの個別ページにジャンプするためのデータ
export type ReferSyllabus = {
	initForm: () => Record<string, string>
	digest: Record<string, string>
	method: string
	url: string
	options: {
		nendo: string
		jikanwariShozokuCode: string
		jikanwaricd: string
		locale: string
	}
}

const parseSearchResultTable = (table: HTMLTableElement) => {
	const headers = Array.from(table.tHead!.rows[0].cells)
	return Array.from(table.tBodies[0].rows).reduce((acc, row) => {
		const cells = Array.from(row.cells).map((c, i) => [headers[i], c])
		const o = cells.reduce((acc, [header, cell]) => {
			const headerText = header.textContent!.replace(/\s+/g, "")
			if (headerText === "参照") {
				return {
					...acc,
					[headerText]: cell.firstElementChild as HTMLInputElement,
				}
			}
			return {
				...acc,
				[headerText]: cell.textContent!.trim(),
			}
		}, {} as any)
		return [...acc, o]
	}, [] as (Record<string, string> & { 参照: HTMLInputElement })[])
}

const listReferSyllabusInSearchPage = async function* (
	session: Fetch,
	fragment: DocumentFragment,
	url: string,
	bodyHTML: string = ""
) {
	const searchResultTable = fragment.querySelector(
		"table[class=normal]"
	) as HTMLTableElement
	if (!searchResultTable) {
		console.error(bodyHTML)
		const errors = fragment.querySelectorAll(".error")
		if (errors.length) {
			throw new Error(errors[0].textContent!.trim())
		}
		throw new Error("table みつからん!")
	}
	const tables = parseSearchResultTable(searchResultTable)
	const jikanwariInputForm = fragment.getElementById(
		"jikanwariInputForm"
	)! as HTMLFormElement
	const jikanwariInputInput = convertFormElementsToPlainKeyValueObject(
		jikanwariInputForm
	)
	for (const { 参照, ...digest } of tables) {
		const onclick = 参照.getAttribute("onclick")!
		if (!onclick.startsWith("refer("))
			throw new Error(`参照ボタンの onclick が期待と違います: ${onclick}`)
		// eval で呼ばれるやつ
		const refer = (
			nendo: string,
			jscd: string,
			jcd: string,
			locale: string
		): ReferSyllabus => {
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
		const backButton = Array.from(fragment.querySelectorAll("a")).filter(
			(v) => v.textContent?.trim() === "検索結果に戻る"
		)
		if (backButton.length) {
			console.log(backButton.length)
			await session(backButton[0].href, { credentials: "includes" })
		}
	}
}

const searchSyllabusSearchForm = async (
	session: Fetch,
	menu: Menu,
	options: Record<string, string>
) => {
	const syllabusSearchPage = await fetchFlowByMenu(
		session,
		menu,
		"シラバス参照"
	)
	const syllabusSearchPageHTML = await syllabusSearchPage.text()
	const syllabusSearchPageFragment = JSDOM.fragment(syllabusSearchPageHTML)

	const jikanwariSearchForm = syllabusSearchPageFragment.getElementById(
		"jikanwariSearchForm"
	) as HTMLFormElement | null
	if (!jikanwariSearchForm) {
		console.error(syllabusSearchPageHTML)
		throw new Error("時間割検索フォームがみあたりません")
	}
	// 検索条件を決定する
	// TODO: option の中身を用いてバリデーションする
	// TODO: フォームの name= が足りてるか確認したい
	const jikanwariSearchFormInput = convertFormElementsToPlainKeyValueObject(
		jikanwariSearchForm,
		{ selectByOptionInnerText: options }
	)

	return session(
		resolve(syllabusSearchPage.url, jikanwariSearchForm.action),
		{
			method: jikanwariSearchForm.method,
			body: new URLSearchParams(jikanwariSearchFormInput).toString(),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			credentials: "includes",
		}
	)
}

export async function* search(session: Fetch, searchOption: Option) {
	const menu = await fetchMenu(session)

	// memo: 一気に取ってこようとしても「ページの有効期限が過ぎています。」などと言われてしまうので、少なくしておきページを進めるたびに読み直す
	const displayCount = 20
	const search = () =>
		searchSyllabusSearchForm(session, menu, {
			// FIXME: 型 :(
			...(searchOption as any),
			_displayCount: displayCount.toString(10),
		})
	const searchResult = await search()
	const searchResultText = await searchResult.text()
	const searchResultFragment = JSDOM.fragment(searchResultText)
	// memo: 1ページ目はページング不要なのでさきに返却する
	for await (const refer of listReferSyllabusInSearchPage(
		session,
		searchResultFragment,
		searchResult.url,
		searchResultText
	)) {
		yield refer
	}

	const parseNextPageUrls = (fragment: DocumentFragment, baseURL: string) => {
		const map = Array.from(fragment.querySelectorAll("a")).reduce(
			(s, i) => {
				s.set(
					Number.parseInt(i.textContent?.trim() || ""),
					resolve(baseURL, i.href)
				)
				return s
			},
			new Map<number, string>()
		)
		map.delete(Number.NaN)
		if (map.size === 0)
			throw new Error(
				"検索結果のページングをパースしようとしましたが、空しか帰ってきませんでした"
			)
		return map
	}
	const splitExact = (target: string, sep: string, pos: number) => {
		const splitted = target.split(sep)
		if (pos >= splitted.length)
			throw new Error(
				`${target} を ${sep} で区切ったあと ${pos} 番目の要素を取得しようとしましたがありませんでした`
			)
		return splitted[pos]
	}
	const parseResultCount = (fragment: DocumentFragment) => {
		const results = Array.from(fragment.childNodes)
			.filter((n) => n.nodeName === "#text")
			.filter((t) => t.textContent?.includes("の検索結果を表示"))
		if (!results.length)
			throw new Error(
				"検索結果ページに「の検索結果を」が含まれる #text ノードがありませんでした"
			)
		const target = results[0].textContent!
		const count = splitExact(
			splitExact(target, "全部で", 1),
			"件あります",
			0
		).trim()
		return Number.parseInt(count)
	}

	// ページングを全部取得する
	const syllabusCount = parseResultCount(searchResultFragment)
	const pageCount = Math.ceil(syllabusCount / displayCount)
	console.log(
		`fetching ${syllabusCount} syllabuses (from ${pageCount} pages)`
	)
	// memo: 1ページ目はすでに返却済みなので2から、1-indexed なのはページングのリンクに書かれている human-friendly なページ数と合わせるため
	for (let cp = 2; cp <= pageCount; cp++) {
		console.log(`Move to page ${cp} / ${pageCount}`)
		// 「ページの有効期限が過ぎています。」などと言われてしまうのでページングを進めるたびに読み直し、該当ページのリンクを取得するまでページを動かす
		const nextPageUrl = await (async (targetPage: number) => {
			const searchResultAgain = await search()
			let currentPage = await searchResultAgain.text()
			let i = 0
			while (true) {
				// 無限ループ対策
				i++
				if (i > targetPage) throw new Error("unreachable code")

				// FIXME: searchResultAgain.url ではなく現在参照しているページの URL を見るようにしたい
				const nextPageUrlMap = parseNextPageUrls(
					JSDOM.fragment(currentPage),
					searchResultAgain.url
				)
				const maxNearlyPage = Array.from(nextPageUrlMap.keys())
					.filter((key) => key <= targetPage)
					.reduce(function max(max, mayMax) {
						return max < mayMax ? mayMax : max
					})
				console.log(
					`Move to page ${targetPage} via page ${maxNearlyPage}`
				)
				if (maxNearlyPage === targetPage)
					return nextPageUrlMap.get(maxNearlyPage)!
				const nextPage = await session(
					nextPageUrlMap.get(maxNearlyPage)!,
					{ credentials: "includes" }
				)
				currentPage = await nextPage.text()
			}
		})(cp)
		const currentSearchResult = await session(nextPageUrl, {
			credentials: "includes",
		})
		const currentSearchResultHTML = await currentSearchResult.text()
		const currentSearchResultFragment = JSDOM.fragment(
			currentSearchResultHTML
		)
		for await (const refer of listReferSyllabusInSearchPage(
			session,
			currentSearchResultFragment,
			currentSearchResult.url,
			currentSearchResultHTML
		)) {
			yield refer
		}
	}
}

export const fetchSyllabusHTMLByRefer = async (
	session: Fetch,
	refer: ReferSyllabus
) => {
	const form = { ...refer.initForm(), ...refer.options }
	return session(refer.url, {
		method: refer.method,
		body: new URLSearchParams(form).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		credentials: "includes",
	}).then((r) => r.text())
}
