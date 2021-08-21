import { parseUpdatedAtLikeDateStringAsJSTDate } from "ducs-lib/dist/campussquare-syllabus/parse"
import { pick } from "ducs-lib/dist/campussquare-syllabus/tree"
import fetch from "node-fetch"
import {
	DEFAULT_DUMP_DIRECTORY,
	isInvalidDate,
	ParsedSyllabuses,
	parsingProgressBar,
	readAndParseDumpedSyllabus,
	schoolYear,
} from "./internal"

const SLACK_WEBHOOK_URI = process.env.SLACK_WEBHOOK_URI!

const UPDATED_AT_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "更新日/Last updated",
}

const toBlock = (s: ParsedSyllabuses[0], updatedAt: Date) => {
	const facility = pick(s.contentTree, {
		titlePath: [
			"講義概要/Course Information",
			"科目基礎情報/General Information",
		],
		contentKey: "開講コース・課程/Faculty offering the course",
	})
	const yearOffered = pick(s.contentTree, {
		titlePath: [
			"講義概要/Course Information",
			"科目基礎情報/General Information",
		],
		contentKey: "開講年次/Year offered",
	})
	const text = `${s.digest.科目} のシラバスが更新されました`
	return {
		type: "context",
		elements: [
			{
				type: "plain_text",
				text,
			},
			{
				type: "mrkdwn",
				text: `${updatedAt.toLocaleString()} | ${facility} | 開講年次: ${yearOffered} | 時間割コード: ${
					s.digest.時間割コード
				}`,
			},
		],
	}
}

const split = <T>(ta: T[], times: number): T[][] => {
	return ta.reduce(
		(res, current) => {
			const t = res[res.length - 1]
			if (t.length >= times) {
				res.push([current])
				return res
			}
			t.push(current)
			return res
		},
		[[]] as T[][]
	)
}

const postToSlack = async (allBlocks: ReturnType<typeof toBlock>[]) => {
	for (const blocks of split(allBlocks, 50)) {
		const res = await fetch(SLACK_WEBHOOK_URI, {
			method: "POST",
			body: JSON.stringify({
				text: "シラバスの更新がありました",
				blocks,
			}),
			headers: {
				"Content-Type": "application/json",
			},
		})
		if (res.status > 200) {
			console.log(res.status)
			console.log(await res.text())
		}
	}
}

const inRange = (target: Date, from: Date, to: Date) =>
	from.getTime() <= target.getTime() && target.getTime() <= to.getTime()

const main = async (fromDate: Date, endDate: Date, dumpDir: string) => {
	if (isInvalidDate(fromDate) || isInvalidDate(endDate)) {
		throw new Error(`開始日 (${fromDate}) か終了日 (${endDate}) が異常です`)
	}
	console.log(fromDate)
	console.log(endDate)

	const blocks: { block: ReturnType<typeof toBlock>; updatedAt: Date }[] = []
	for (const s of await readAndParseDumpedSyllabus(
		dumpDir,
		schoolYear().toString(),
		parsingProgressBar()
	)) {
		const updatedAtDateString = pick(s.contentTree, UPDATED_AT_PATH)
		if (!updatedAtDateString) throw new Error("NG")
		const updatedAt = parseUpdatedAtLikeDateStringAsJSTDate(
			updatedAtDateString
		)
		if (!inRange(updatedAt, fromDate, endDate)) {
			continue
		}

		blocks.push({ block: toBlock(s, updatedAt), updatedAt })
	}
	if (!blocks.length) return
	await postToSlack(
		blocks
			.sort((a, b) =>
				a.updatedAt.getTime() < b.updatedAt.getTime() ? -1 : 1
			)
			.map((b) => b.block)
	)
}

main(
	parseUpdatedAtLikeDateStringAsJSTDate(process.argv[2]),
	parseUpdatedAtLikeDateStringAsJSTDate(process.argv[3]),
	process.argv[4] || DEFAULT_DUMP_DIRECTORY
)
	.then(() => {
		process.exit(0)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
