import { promises as fs } from "fs"
import * as path from "path"
import * as crypto from "crypto"
import ProgressBar from "progress"
import $, { Transformer } from "transform-ts"
import { ReferSyllabus } from "ducs-lib/dist/campussquare-syllabus/search"
import { parseSyllabusPageHTML } from "ducs-lib/dist/campussquare-syllabus/parse"

const DIGEST_SCHEMA = $.obj({
	学期: $.literal("前学期", "後学期"),
	開講: $.literal("前学期", "後学期", "通年"),
	// TODO: 本当は $.array($.string) にしたい
	"曜日・時限": $.string,
	時間割コード: $.string,
	科目: $.string,
})

type AsyncGeneratorOf<T extends AsyncGenerator> = T extends AsyncGenerator<
	infer I,
	any,
	any
>
	? I
	: never

const HTML_FILE_NAME = "reference.html"
const DIGEST_FILE_NAME = "digest.json"

// 適当に _flowExecutionKey が含まれる行を無かったことにする
// 同一データ判定をするため
const maskFlowExecutionKeyLine = (html: string): string =>
	html
		.split("\n")
		.filter((l) => !l.includes("_flowExecutionKey"))
		.join("\n")

const ignoreHiddenFile = (name: string) => name.startsWith(".")
const iterateWithout = function* <T>(
	source: Iterable<T>,
	ignore: (item: T) => boolean
) {
	for (const i of source) {
		if (ignore(i)) continue
		yield i
	}
}

export const DEFAULT_DUMP_DIRECTORY = "./dump"

export const arrayFromAsyncIterator = async <T>(
	i: AsyncGenerator<T, void, unknown>
): Promise<T[]> => {
	const r: T[] = []
	for await (const c of i) {
		r.push(c)
	}
	return r
}

export const saveReferAndSyllabusPage = async (
	dir: string,
	refer: ReferSyllabus,
	html: string
) => {
	const dest = path.join(dir, refer.options.nendo, refer.options.jikanwaricd)
	await fs.mkdir(dest, { recursive: true })
	await Promise.all([
		fs.writeFile(
			path.join(dest, DIGEST_FILE_NAME),
			JSON.stringify(refer.digest, null, 2),
			{ encoding: "utf-8" }
		),
		fs.writeFile(path.join(dest, HTML_FILE_NAME), html),
	])
}

export const readAllDumpedSyllabus = async function* (
	dir: string,
	year: string
): AsyncGenerator<{
	digest: Transformer.TypeOf<typeof DIGEST_SCHEMA>
	html: string
}> {
	const src = path.join(dir, year)
	// 例外が起きたらそのままさよなら…
	const jikanwaricds = await fs.readdir(src)
	for (const cd of iterateWithout(jikanwaricds, ignoreHiddenFile)) {
		const cdp = path.join(src, cd)
		const files = await fs.readdir(cdp)
		const ok =
			files.length == 2 &&
			files.includes(HTML_FILE_NAME) &&
			files.includes(DIGEST_FILE_NAME)
		if (!ok) throw new Error(`not dump directory: ${src}/${cd}`)
		try {
			yield {
				digest: DIGEST_SCHEMA.transformOrThrow(
					JSON.parse(
						await fs.readFile(path.join(cdp, DIGEST_FILE_NAME), {
							encoding: "utf8",
						})
					)
				),
				html: await fs.readFile(path.join(cdp, HTML_FILE_NAME), {
					encoding: "utf-8",
				}),
			}
		} catch (e) {
			throw new Error(`failed to read ${cd}: ${e}`)
		}
	}
}

export type ParsedSyllabuses = Array<
	AsyncGeneratorOf<ReturnType<typeof readAllDumpedSyllabus>> & {
		contentTree: ReturnType<typeof parseSyllabusPageHTML>
	}
>
// メモリにツリー内容を全展開するショートハンド関数
// キャッシュも行う
export const readAndParseDumpedSyllabus = async (
	dir: string,
	year: string,
	parseProgress?: (value: number, max: number) => void
): Promise<ParsedSyllabuses> => {
	const src = await arrayFromAsyncIterator(readAllDumpedSyllabus(dir, year))
	let i = 0
	const a: ParsedSyllabuses = []
	for (const { html, ...rest } of src) {
		const hash = crypto
			.createHash("sha256")
			.update(maskFlowExecutionKeyLine(html), "utf8")
			.digest("hex")
		const data = await useCache(
			rest.digest.時間割コード,
			() => ({
				...rest,
				html,
				contentTree: parseSyllabusPageHTML(html),
			}),
			() => hash
		)
		a[a.length] = data
		if (parseProgress) parseProgress(i++, src.length)
	}
	return a
}
export const parsingProgressBar = () =>
	useProgressBar("Parsing [:bar] :percent :elapseds :current/:total")

export const schoolYear = (d: Date = new Date()) => {
	let year = d.getFullYear()
	// 1 ~ 3月ならば前年にする
	if (d.getMonth() < 3) year--
	return year
}

export const isInvalidDate = (d: Date) => isNaN(d.getTime())

export const validMarkerCurrentMonth = () => {
	const now = new Date()
	return `${now.getFullYear()}_${now.getMonth() + 1}`
}
export const useCache = async <T>(
	name: string,
	f: () => T,
	validMarker: () => string = validMarkerCurrentMonth,
	cacheStore: string = "./caches"
): Promise<T> => {
	await fs.mkdir(cacheStore, { recursive: true })
	const filename = path.join(cacheStore, `${name}-${validMarker()}.json`)
	try {
		const json = await fs.readFile(filename, { encoding: "utf-8" })
		return JSON.parse(json) as any
	} catch (e) {
		if (e.code !== "ENOENT") {
			// キャッシュミスとして扱う
			console.error(`cache file is invalid (${filename}): ${e}`)
		}
	}

	const res = await f()
	await fs.writeFile(filename, JSON.stringify(res), {
		encoding: "utf-8",
	})
	return res
}

export const useProgressBar = (bar: string = "[:bar]") => {
	let pb: ProgressBar
	return (c: number, m: number) => {
		if (!pb)
			pb = new ProgressBar(bar, { total: m, width: 30, incomplete: " " })
		pb.tick()
	}
}
