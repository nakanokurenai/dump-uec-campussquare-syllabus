import * as signin from "ducs-lib/dist/campussquare/signin"
import {
	fetchSyllabusHTMLByRefer,
	search,
} from "ducs-lib/dist/campussquare-syllabus/search"
import { PromiseGroup } from "ducs-lib/dist/utils/promise-group"
import { DEFAULT_DUMP_DIRECTORY, saveReferAndSyllabusPage } from "./internal"

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

async function main(dumpDir: string) {
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

	const g = new PromiseGroup<void>(5)
	for await (const refer of search(session, {
		nenji: "指示なし",
		// デフォルト値はアカウントの所属
		jikanwariShozokuCode: "指示なし",
		gakkiKubunCode: "指示なし",
	})) {
		g.enqueue(async () => {
			const page = await fetchSyllabusHTMLByRefer(session, refer)
			await saveReferAndSyllabusPage(dumpDir, refer, page)
		})
		await g.acquire()
	}
	await g.all()
}

main(process.argv[2] || DEFAULT_DUMP_DIRECTORY)
	.then(() => {
		process.exit(0)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
