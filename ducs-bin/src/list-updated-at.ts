import { pick } from "ducs-lib/dist/campussquare-syllabus/tree"
import { parse, differenceInCalendarDays } from "date-fns"
import { parseUpdatedAtLikeDateStringAsJSTDate } from "ducs-lib/dist/campussquare-syllabus/parse"

const UPDATED_AT_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "更新日/Last updated",
}

const read = () => require("../../syllabus.json")

const main = async (from: Date) => {
	console.log(from.toLocaleString("ja-JP"))
	const syllabus: any[] = read()
	syllabus.forEach((s) => {
		const ds = pick(s["contentTree"], UPDATED_AT_PATH)
		if (!ds) throw new Error()
		const d = parseUpdatedAtLikeDateStringAsJSTDate(ds)
		const differ = differenceInCalendarDays(d, from)
		if (differ >= 0) {
			console.log(`${s["科目"]}: ${d.toLocaleString("ja-JP")}`)
		}
	})
}

main(parse(process.argv[2] + " +0900", "yyyy/MM/dd xx", new Date(0))).catch(
	console.error
)
