import $, { Transformer } from "transform-ts"
import {
	TREE_SCHEMA,
} from "ducs-lib/dist/campussquare-syllabus/tree"

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
        contentHTML: $.string,
	})
)
type SyllabusJSON = Transformer.TypeOf<typeof SYLLABUS_SCHEMA>

const readSyllabus = (): Promise<SyllabusJSON> =>
	Promise.resolve(
		SYLLABUS_SCHEMA.transformOrThrow(require("../syllabus.json"))
	)

const LIST = `\
# 月7 応用数学第一
22021101
# 火7 基礎解析学
22019106
# 水1 技術史
21011116
# 水4 複素関数論（Ⅰ類）
21122119
# 水6
22011101
22011102
22011104
22011105
# 水7 電子回路学
22021110
# 木1 宇宙・地球科学 (昼間科目) 後期だったわw
# 21015201
# 木7 通信・ネットワーク
22023103
# 金7 国際文化論
22016102
# 土1 基礎物理学第三
22019107
# 土2,3 電磁気学および演習
22021104
# 土4,5 アナログ回路実験
22021105
# 土4,5 プログラミング実験
22021106

# 計算理論。後期だったわw
# 21124231
# コンピュータグラフィックス。後期だったわ2w
# 21124232

# とれそうな科目
21124123
21124118
`

import * as fs from 'fs'

async function main() {
    const s = await readSyllabus()

    const codes = LIST.split('\n').filter(n => !n.startsWith("#")).filter(n => n.trim().length).map(n => n.trim())
    const syllas = s.filter(s => codes.includes(s.digest.時間割コード))

    if (codes.length != syllas.length) {
        throw new Error(`長さが違います: ${codes.length} != ${syllas.length}`)
    }

    await fs.promises.writeFile("./partial-syllabuses.json", JSON.stringify(syllas, null, 2))
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
