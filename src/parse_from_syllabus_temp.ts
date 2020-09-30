import { writeFileSync, readFileSync } from 'fs'
import { parseSyllabusPageHTML } from './campussquare-syllabus/parse'
import { ReferSyllabus } from './campussquare-syllabus/search'

const main = async () => {
  const syllabusPages: { refer: ReferSyllabus, syllabusHTML: string }[] = JSON.parse(readFileSync('./syllabus_temp.json', { encoding: 'utf-8' }))
  const exp = await Promise.all(syllabusPages.map(async ({ refer, syllabusHTML }, i) => {
    return {
      ...refer.digest,
      contentTree: await (() => {
        try {
          console.log(`Parsing ${i+1} / ${syllabusPages.length} …`)
          return parseSyllabusPageHTML(syllabusHTML)
        } catch (e) {
          console.error(e)
          return null
        }
      })(),
      contentHTML: syllabusHTML,
    }
  }))
  writeFileSync('./syllabus.json', JSON.stringify(exp, null, 2), {encoding: 'utf8'})
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
