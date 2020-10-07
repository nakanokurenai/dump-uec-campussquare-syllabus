import { pick } from "../campussquare-syllabus/tree"
import { parse, differenceInDays } from "date-fns"

const UPDATED_AT_PATH = {
	path: ["講義概要/Course Information", "科目基礎情報/General Information"] as [string, string],
	key: "更新日/Last updated"
}

const parseSyllabusUpdatedAt = (d: string) => parse(d + " +0900", "yyyy/MM/dd HH:mm:ss xx", new Date(0))

const read = () => require("../../syllabus.json")

const main = async (from: Date) => {
	console.log(from)
	const syllabus: any[] = read()
	syllabus.forEach(s => {
		const ds = pick(s["contentTree"], { titlePath: UPDATED_AT_PATH.path, contentKey: UPDATED_AT_PATH.key })
		if (!ds) throw new Error()
		const d = parseSyllabusUpdatedAt(ds)
		const differ = differenceInDays(d, from)
		if (differ >= 0) {
			console.log(`${s["科目"]}: ${d}`)
		}
	})
}

main(parse(process.argv[2] + " +0900", "yyyy/MM/dd xx", new Date(0))).catch(console.error)
