export type SyllabusTree = {
	title: string
	content?: { [key: string]: string }
	// JSON からパースするときにこれがない扱いにしたほうが楽なことがあり optional にしたほうがいいかも…
	children?: SyllabusTree[]
}

export const convertSyllabusTreeToMarkdown = (
	{ content, title, children }: SyllabusTree,
	depth = 1
): string => {
	return `\
${"#".repeat(depth)} ${title}
${
	content
		? "\n" +
		  Object.entries(content)
				.filter(([, value]) => value.trim())
				.map(([key, value]) => {
					const padding = "    "
					return (
						`- ${key}\n` +
						`${padding}${value
							.split("\n")
							.map((c) => c.trim().replace(/\s+/g, " "))
							.join(`\n${padding}`)}`
					)
				})
				.join("\n")
		: ""
}\
${
	children && children.length
		? "\n" +
		  children
				.map((c) => convertSyllabusTreeToMarkdown(c, depth + 1))
				.join("\n")
		: ""
}
`
}

export type Path = {
	titlePath: [string, string]
	contentKey: string
}
export const pick = (
	tree: SyllabusTree,
	{ titlePath, contentKey }: Path
): string | undefined => {
	const findContent = (
		c: SyllabusTree[],
		p: string[]
	): SyllabusTree | undefined => {
		const t = c.find((n) => n.title === p[0])
		if (!t) return undefined
		if (p.length === 1) return t
		if (!t.children) throw new Error("子が見つかりませんでした")
		return findContent(t.children, p.slice(1))
	}

	const c = findContent([tree], titlePath)
	if (!c) return undefined
	if (!c.content)
		throw new Error(
			"タイトルパスは見つかりましたが、コンテンツが含まれませんでした"
		)
	return c.content[contentKey]
}
