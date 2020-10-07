import { differenceInCalendarDays, parse } from 'date-fns'
import $, { Transformer } from 'transform-ts'
import { parseUpdatedAtLikeDateStringAsJSTDate } from '../campussquare-syllabus/parse'
import { pick, TREE_SCHEMA } from '../campussquare-syllabus/tree'
import fetch from 'node-fetch'

const SLACK_WEBHOOK_URI = process.env.SLACK_WEBHOOK_URI!

const SYLLABUS_SCHEMA = $.array(
	$.obj({
		digest: $.obj({
			学期: $.literal("前学期", "後学期"),
			開講: $.literal("前学期", "後学期", "通年"),
			// TODO: 本当は $.array($.string) にしたい
			"曜日・時限": $.string,
			時間割コード: $.string,
			科目: $.string,
		}),
		contentTree: TREE_SCHEMA,
	})
)
type SyllabusJSON = Transformer.TypeOf<typeof SYLLABUS_SCHEMA>

const readSyllabus = (): Promise<SyllabusJSON> =>
	Promise.resolve(
		SYLLABUS_SCHEMA.transformOrThrow(require("../../syllabus.json"))
	)

const UPDATED_AT_PATH = {
	titlePath: ["講義概要/Course Information", "科目基礎情報/General Information"] as [string, string],
	contentKey: "更新日/Last updated"
}

const postToSlack = async (s: SyllabusJSON[0], updatedAt: Date) => {
	const facility = pick(s.contentTree, { titlePath: ["講義概要/Course Information", "科目基礎情報/General Information"], contentKey: "開講コース・課程/Faculty offering the course" })
	const yearOffered = pick(s.contentTree, { titlePath: ["講義概要/Course Information", "科目基礎情報/General Information"], contentKey: "開講年次/Year offered" })
	const text = `${s.digest.科目} のシラバスが更新されました`
	const res = await fetch(SLACK_WEBHOOK_URI, {
		method: "POST",
		body: JSON.stringify({
			text,
			blocks: [
				{
					type: "section",
					text: {
						type: "plain_text",
						text,
					}
				},
				{
					type: "context",
					elements: [
						{
							type: "mrkdwn",
							text: `${updatedAt.toLocaleString()} | ${facility} | 開講年次: ${yearOffered} | 時間割コード: ${s.digest.時間割コード}`
						}
					]
				}
			],
		}),
		headers: {
			'Content-Type': 'application/json'
		}
	})
	if (res.status > 200) {
		console.log(res.status)
		console.log(await res.text())
	}
}

const main = async (fromDate: Date) => {
	const sj = await readSyllabus()
	const toNotify: { syllabus: SyllabusJSON[0], updatedAt: Date }[] = []
	for (const s of sj) {
		const updatedAtDateString = pick(s.contentTree, UPDATED_AT_PATH)
		if (!updatedAtDateString) throw new Error("NG")
		const updatedAt = parseUpdatedAtLikeDateStringAsJSTDate(updatedAtDateString)
		const differ = differenceInCalendarDays(updatedAt, fromDate)
		if (differ < 0) {
			continue
		}

		toNotify.push({ syllabus: s, updatedAt })
	}
	for (const s of toNotify.sort((a, b) => a.updatedAt.getTime() < b.updatedAt.getTime() ? -1 : 1)) {
		await postToSlack(s.syllabus, s.updatedAt)
	}
}

main(parse(process.argv[2] + " +0900", "yyyy/MM/dd xx", new Date(0)))
	.then(() => {
		process.exit(0)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
