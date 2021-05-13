import { promises as fs } from "fs"
import * as path from "path"
import { ReferSyllabus } from "ducs-lib/dist/campussquare-syllabus/search"

export const saveReferAndSyllabusPage = async (
	dir: string,
	refer: ReferSyllabus,
	html: string
) => {
	const dest = path.join(dir, refer.options.nendo, refer.options.jikanwaricd)
	await fs.mkdir(dest, { recursive: true })
	await fs.writeFile(
		path.join(dest, "digest.json"),
		JSON.stringify(refer.digest, null, 2),
		{ encoding: "utf-8" }
	)
	await fs.writeFile(path.join(dest, "reference.html"), html)
}
