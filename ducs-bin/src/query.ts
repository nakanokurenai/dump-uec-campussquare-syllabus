import cac from "cac"
import { promises as fs, constants } from "fs"
import * as path from "path"

import { pick } from "ducs-lib/dist/campussquare-syllabus/tree"
import {
	Digest,
	parsingProgressBar,
	readAndParseDumpedSyllabus,
	schoolYear,
} from "./internal"

const debug = (...args: any[]) => {
	// console.error(...args)
}

const CODE_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "科目番号/Code",
}
const YEAR_OFFERED_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "開講年次/Year offered",
}
const DEPARTMENT_PATH = {
	titlePath: [
		"講義概要/Course Information",
		"科目基礎情報/General Information",
	] as [string, string],
	contentKey: "開講学科・専攻/Cluster/Department",
}

const match = <T>(actual: T, expected: T | T[]): boolean => {
	if (Array.isArray(expected)) {
		return expected.includes(actual)
	}
	return actual === expected
}

const matchAll = <T>(actual: T | T[], expected: T | T[]): boolean => {
	if (!Array.isArray(actual)) {
		return match(actual, expected)
	}
	if (!actual.length) {
		return false
	}
	let someMatched = false
	for (const a of actual) {
		if (match(a, expected)) {
			someMatched = true
			break
		}
	}
	return someMatched
}

const semesters = ["前学期", "後学期", "通年"] as const
type Semester = typeof semesters[number]
type QueryFilter = {
	semester?: Semester | Semester[]
	subject?: string[] | string
	code?: string[] | string
	day?: string[] | string
	department?: string[] | string

	timetableCode?: string[] | string | number | number[]
	period?: number[] | number
	grade?: number[] | number
}
const query = async (
	dir: string,
	year: string,
	filter: QueryFilter = {}
): Promise<Digest[]> => {
	const matchable = {
		...filter,
		timetableCode: !filter.timetableCode
			? undefined
			: Array.isArray(filter.timetableCode)
			? (filter.timetableCode as any[]).map((c: any) => c.toString())
			: filter.timetableCode.toString(),
		period: !filter.period
			? undefined
			: Array.isArray(filter.period)
			? filter.period.map((p) => p.toString())
			: filter.period.toString(),
		grade: !filter.grade
			? undefined
			: Array.isArray(filter.grade)
			? filter.grade.map((p) => p.toString())
			: filter.grade.toString(),
	}
	const digests: Digest[] = []
	for (const { digest, contentTree } of await readAndParseDumpedSyllabus(
		dir,
		year,
		parsingProgressBar()
	)) {
		const dayAndPeriods = digest["曜日・時限"]
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length)
		if (matchable.semester && !matchAll(digest.学期, matchable.semester)) {
			continue
		}
		if (
			matchable.timetableCode &&
			!matchAll(digest.時間割コード, matchable.timetableCode)
		) {
			continue
		}
		if (matchable.subject && !matchAll(digest.科目, matchable.subject)) {
			continue
		}
		if (
			matchable.day &&
			!matchAll(
				dayAndPeriods
					.filter((dp) => dp.length === 2)
					.map((dp) => dp.substr(0, 1)),
				matchable.day
			)
		) {
			continue
		}
		if (matchable.period) {
			if (
				!matchAll(
					dayAndPeriods
						.filter((dp) => dp.length === 2)
						.map((dp) => dp.substr(1)),
					matchable.period
				)
			) {
				continue
			}
		}
		if (matchable.grade) {
			const grade = pick(contentTree, YEAR_OFFERED_PATH)
			if (!grade || !grade.trim()) {
				debug(
					`${digest.科目} (${digest.時間割コード}) の開講年次は空のようです`
				)
				continue
			}
			const grades = grade
				.split("/")
				.map((g) => g.trim())
				.filter((g) => g.length)
			Object.assign(digest, { grades }) // dirty hack
			if (!matchAll(grades, matchable.grade)) {
				continue
			}
		}
		if (matchable.code) {
			const code = pick(contentTree, CODE_PATH)
			if (!code || !code.trim()) {
				debug(
					`${digest.科目} (${digest.時間割コード}) の科目番号が空のようです`
				)
				continue
			}
			const codes = code
				.split(" ")
				.map((c) => c.trim())
				.filter((c) => c.length)
			Object.assign(digest, { codes }) // dirty hack
			if (!matchAll(matchable.code, codes)) {
				continue
			}
		}
		if (matchable.department) {
			const dep = pick(contentTree, DEPARTMENT_PATH)
			if (!dep || !dep.trim()) {
				debug(
					`${digest.科目} (${digest.時間割コード}) の ${DEPARTMENT_PATH.contentKey} が空のようです`
				)
				continue
			}
			if (!matchAll(matchable.department, dep.trim())) {
				continue
			}
		}

		digests.push(digest)
	}
	return digests
}

const main = () => {
	const cli = cac()
	cli.command("<target>", "dump ディレクトリ名")
		.option("-y, --year <year>", "SY", {
			default: schoolYear().toString(),
		})
		.option("--semester [...semester]", "学期")
		.option("-s, --subject [...subject]", "科目名")
		.option("-c, --code [...code]", "科目コード")
		.option("-t, --timetableCode [...timetableCode]", "時間割コード")
		.option("-d, --day [...day]", "曜日")
		.option("-p, --period [...period]", "時限 (数値)")
		.option("-g, --grade [...grade]", "学年 (数値)")
		.option("--department [...department]", "開講学科・専攻")
		.option("--copyTo [copyTo]", "マッチしたものをコピーする")
		.action(async (target, options) => {
			console.error(options)

			if (options["semester"]) {
				if (!matchAll(options["semester"], semesters)) {
					throw new Error(
						`学期は "前学期", "後学期", "通年" のいずれかで入れてください`
					)
				}
			}
			const digests = await query(target, options["year"], options).catch(
				(e) => {
					console.error(e)
					process.exit(1)
				}
			)
			console.log(JSON.stringify(digests, null, 4))

			if (options["copyTo"]) {
				console.log("copying…")
				const base = path.join(options["copyTo"], options["year"])
				for (const digest of digests) {
					const dir = path.join(base, digest.時間割コード)
					await fs.mkdir(dir, { recursive: true })
					for (const file of ["reference.html", "digest.json"]) {
						await fs.copyFile(
							path.join(
								target,
								options["year"],
								digest.時間割コード,
								file
							),
							path.join(dir, file),
							constants.COPYFILE_FICLONE
						)
					}
				}
			}
		})
	cli.help()
	cli.parse()
}

main()
