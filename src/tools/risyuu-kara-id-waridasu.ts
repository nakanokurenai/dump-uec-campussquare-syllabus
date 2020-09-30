import { search } from "../campussquare-syllabus/search"
import { fetchFlowByMenu, fetchMenu, Menu } from "../campussquare/menu"
import * as signin from "../campussquare/signin"
import { Fetch } from "../utils/baked-fetch"
import * as fs from "fs"
import { JSDOM } from "jsdom"
import { convertFormElementsToPlainKeyValueObject } from "../utils/dom"
import { resolve } from "url"
import { PromiseType } from "../utils/types"

const COURSE_REGISTRATION_OR_VIEW_CURRENT_REGISTERED_COURCES =
	"履修登録・登録状況照会"

const question = (question: string) =>
	new Promise<string>((res, rej) => {
		process.stdout.write(question)
		if (!process.stdin.readable) return rej("not readable.")
		let all: string = ""
		while (process.stdin.read()) {
			process.stdin.readable
		}
		const onData = (chunk: Buffer) => {
			all += chunk
			if (all.includes("\n")) {
				onEnd()
			}
		}
		const onEnd = () => {
			process.stdin.removeListener("data", onData)
			process.stdin.removeListener("end", onEnd)
			res(all.trim())
		}
		process.stdin.on("data", onData)
		process.stdin.on("end", onEnd)
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

const fetchAllDigest = async function* (session: Fetch) {
	// 今年度の全てのシラバス要約を取得
	for await (const digest of search(session, {
		nenji: "指示なし",
		jikanwariShozokuCode: "指示なし",
		gakkiKubunCode: "指示なし",
	})) {
		yield digest
	}
}
const arrayFromAsyncIterator = async <T>(
	i: AsyncGenerator<T, void, unknown>
): Promise<T[]> => {
	const r: T[] = []
	for await (const c of i) {
		r.push(c)
	}
	return r
}

const useCache = async <T>(name: string, f: () => T): Promise<T> => {
	const filename = `./cache-${name}.json`
	try {
		const json = await fs.promises.readFile(filename, { encoding: "utf-8" })
		return JSON.parse(json) as any
	} catch (e) {
		if (e.code !== "ENOENT") {
			throw e
		}
	}

	const res = await f()
	await fs.promises.writeFile(filename, JSON.stringify(res), {
		encoding: "utf-8",
	})
	return res
}

const fetchRegisteredCources = async (session: Fetch, menu: Menu) => {
	const digests = await useCache("all-digests", () =>
		arrayFromAsyncIterator(fetchAllDigest(session))
	)

	const regPage = await fetchFlowByMenu(
		session,
		menu,
		COURSE_REGISTRATION_OR_VIEW_CURRENT_REGISTERED_COURCES
	)
	const regPageFragment = JSDOM.fragment(await regPage.text())

	const registered = Array.from(
		regPageFragment.querySelectorAll(".rishu-koma-inner")
	)
		.filter((n) => !n.textContent?.includes("未登録"))
		.map((n) => n.textContent?.trim() || "")
		.map((t) => t.split("\n").map((l) => l.trim()))
		.map((v) => {
			if (v.length !== 3)
				throw new Error(`3行に分割できていません: ${JSON.stringify(v)}`)
			return {
				timetableCode: v[0],
				course: v[1],
				lecturers: v[2],
			}
		})

	// シラバス要約 (refer) を用いて "開講所属コード" を割り出す
	return registered.map(({ timetableCode, ...rest }) => {
		const digest = digests.find(
			({ options }) => options.jikanwaricd === timetableCode
		)
		if (!digest)
			throw new Error(
				`履修登録されている時間割コード ${timetableCode} に該当するシラバス要約が見つかりません。キャッシュを利用しないオプションを付けた上で再度実行してみてください`
			)
		return {
			refer: digest,
			timetableCode,
			...rest,
			faculityOfCourse: digest.options.jikanwariShozokuCode,
			courseEquality: digest.digest["科目"] === rest.course,
			lecturersEquality: digest.digest["担当"] === rest.lecturers,
		}
	})
}

const main = async () => {
	const env = loadEnv()
	const session = signin.createSession()

	// ログインが必要ならする
	if (!(await signin.isLoggedIn(session))) {
		await signin.login(
			session,
			env.DUS_USERNAME,
			env.DUS_PASSWORD,
			async () => {
				const mfaPin = await question(
					"You must sign in. Input your MFA code: "
				)
				return Number.parseInt(mfaPin)
			}
		)
		await signin.exportSession(session)
	}

	const menu = await fetchMenu(session)

	const registeredCources = await fetchRegisteredCources(session, menu)

	const syllabusPages: {
		cource: PromiseType<ReturnType<typeof fetchRegisteredCources>>[number]
		syllabusHTML: string
	}[] = []
	for (const cource of registeredCources) {
		const syllabusSearchPage = await fetchFlowByMenu(
			session,
			menu,
			"シラバス参照"
		)
		const syllabusSearchPageHTML = await syllabusSearchPage.text()
		const syllabusSearchPageFragment = JSDOM.fragment(
			syllabusSearchPageHTML
		)
		const jikanwariInputForm = syllabusSearchPageFragment.getElementById(
			"jikanwariInputForm"
		) as HTMLFormElement | null

		if (!jikanwariInputForm)
			throw new Error("時間割コードでシラバスを参照することができません")

		const jikanwariInputFormInput = convertFormElementsToPlainKeyValueObject(
			jikanwariInputForm,
			{}
		)
		jikanwariInputFormInput["jikanwariShozokuCodeForKettei"] =
			cource.faculityOfCourse
		jikanwariInputFormInput["jikanwaricd"] = cource.timetableCode

		const syllabusPage = await session(
			resolve(syllabusSearchPage.url, jikanwariInputForm.action),
			{
				method: jikanwariInputForm.method,
				body: new URLSearchParams(jikanwariInputFormInput).toString(),
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				credentials: "includes",
			}
		)
		const syllabusHTML = await syllabusPage.text()

		syllabusPages.push({ cource, syllabusHTML })
		await fs.promises.writeFile(
			"./risyuu-syllabuses.json",
			JSON.stringify(syllabusPages, null, 2),
			{ encoding: "utf-8" }
		)
	}
	await fs.promises.writeFile(
		"./risyuu-syllabuses.json",
		JSON.stringify(syllabusPages, null, 2),
		{ encoding: "utf-8" }
	)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
