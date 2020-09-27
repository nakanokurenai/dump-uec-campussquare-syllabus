import { writeFileSync } from 'fs'
import * as signin from './campussquare/signin'
import { parseSyllabusPageHTML } from './campussquare-syllabus/parse'
import { fetchSyllabusHTMLByRefer, ReferSyllabus, search } from './campussquare-syllabus/search'

const question = (question: string) => new Promise<string>((res, rej) => {
  process.stdout.write(question)
  if (!process.stdin.readable) return rej('not readable.')
  let all: string = ''
  while (process.stdin.read()) {
    process.stdin.readable
  }
  const onData = (chunk: Buffer) => {
    all += chunk
    if (all.includes('\n')) {
      onEnd()
    }
  }
  const onEnd = () => {
    process.stdin.removeListener('data', onData)
    process.stdin.removeListener('end', onEnd)
    res(all.trim())
  }
  process.stdin.on('data', onData)
  process.stdin.on('end', onEnd)
})

const loadEnv = () => {
  const { DUS_USERNAME, DUS_PASSWORD } = process.env
  const env = { DUS_USERNAME, DUS_PASSWORD }
  Object.entries(env).forEach(([k, v]) => {
    if (!v) {
      console.error(`key ${k} is missing`)
      process.exit(1)
    }
  })
  return env as { [K in keyof typeof env]: string }
}

async function main() {
  const env = loadEnv()
  const session = signin.createSession()

  // ログインが必要ならする
  if (!(await signin.isLoggedIn(session))) {
    await signin.login(session, env.DUS_USERNAME, env.DUS_PASSWORD, async () => {
      const mfaPin = await question('You must sign in. Input your MFA code: ')
      return Number.parseInt(mfaPin)
    })
    await signin.exportSession(session)
  }

  const syllabusPages: { refer: ReferSyllabus, syllabusHTML: string }[] = []
  for await (const refer of search(
    session,
    {
      'nenji': '指示なし',
      // デフォルト値はアカウントの所属
      'jikanwariShozokuCode': '指示なし',
      'gakkiKubunCode': '指示なし',
    }
  )) {
    const syllabusHTML = await fetchSyllabusHTMLByRefer(session, refer)
    syllabusPages.push({ refer, syllabusHTML })
    // 途中で失敗したときの経過を保存しておきたい
    writeFileSync('./syllabus_temp.json', JSON.stringify(syllabusPages, null, 2), { encoding: 'utf8' })
  }

  ;(() => {
    /* export it */
    const exp = syllabusPages.map(({ refer, syllabusHTML }, i) => {
      return {
        ...refer.digest,
        contentTree: (() => {
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
    })
    writeFileSync('./syllabus.json', JSON.stringify(exp, null, 2), {encoding: 'utf8'})
  })()
}

main().then(() => {
  process.exit(0)
}).catch(e => {
  console.error(e)
  process.exit(1)
})
