import { pick } from "ducs-lib/dist/campussquare-syllabus/tree"
import { parse, differenceInCalendarDays } from "date-fns"
import { parseUpdatedAtLikeDateStringAsJSTDate } from "ducs-lib/dist/campussquare-syllabus/parse"
import {
	DEFAULT_DUMP_DIRECTORY,
	isInvalidDate,
	readAndParseDumpedSyllabus,
	schoolYear,
} from "./internal"

const UPDATED_AT_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "更新日/Last updated",
}

const main = async (from: Date) => {
	if (isInvalidDate(from)) throw new Error("日付を入力してください")
	console.log(from.toLocaleString("ja-JP"))

	for (const {
		digest,
		contentTree,
	} of await readAndParseDumpedSyllabus(
		DEFAULT_DUMP_DIRECTORY,
		schoolYear().toString(),
		(i, max) => console.log(`Parsing ${i}/${max}…`)
	)) {
		const ds = pick(contentTree, UPDATED_AT_PATH)
		if (!ds) throw new Error()
		const d = parseUpdatedAtLikeDateStringAsJSTDate(ds)
		const differ = differenceInCalendarDays(d, from)
		if (differ >= 0) {
			console.log(`${digest["科目"]}: ${d.toLocaleString("ja-JP")}`)
		}
	}
}

main(parse(process.argv[2] + " +0900", "yyyy/MM/dd xx", new Date(0))).catch(
	console.error
)
