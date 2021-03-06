import { writeFileSync } from "fs"
import * as signin from "ducs-lib/dist/campussquare/signin"
import { parseSyllabusPageHTML } from "ducs-lib/dist/campussquare-syllabus/parse"
import {
	fetchSyllabusHTMLByRefer,
	ReferSyllabus,
	search,
} from "ducs-lib/dist/campussquare-syllabus/search"
import { PromiseGroup } from "ducs-lib/dist/utils/promise-group"

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

async function main() {
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

	const g = new PromiseGroup<{ refer: ReferSyllabus; syllabusHTML: string }>(
		5
	)
	for await (const refer of search(session, {
		nenji: "指示なし",
		// デフォルト値はアカウントの所属
		jikanwariShozokuCode: "指示なし",
		gakkiKubunCode: "指示なし",
	})) {
		g.enqueue(() =>
			fetchSyllabusHTMLByRefer(session, refer).then((syllabusHTML) => ({
				syllabusHTML,
				refer,
			}))
		)
		await g.acquire()
		// 途中経過の保存
		const pages = await g.allFulfilled()
		writeFileSync("./syllabus_temp.json", JSON.stringify(pages, null, 2), {
			encoding: "utf8",
		})
	}
	const syllabusPages = await g.all()
	// 経過の保存
	writeFileSync(
		"./syllabus_temp.json",
		JSON.stringify(syllabusPages, null, 2),
		{ encoding: "utf8" }
	)

	/* export it */
	const exp = await Promise.all(
		syllabusPages.map(async ({ refer, syllabusHTML }, i) => {
			return {
				digest: refer.digest,
				contentTree: await (() => {
					try {
						console.log(
							`Parsing ${i + 1} / ${syllabusPages.length} …`
						)
						return parseSyllabusPageHTML(syllabusHTML)
					} catch (e) {
						console.error(e)
						return null
					}
				})(),
				contentHTML: syllabusHTML,
			}
		})
	)
	writeFileSync("./syllabus.json", JSON.stringify(exp, null, 2), {
		encoding: "utf8",
	})
}

main()
	.then(() => {
		process.exit(0)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
