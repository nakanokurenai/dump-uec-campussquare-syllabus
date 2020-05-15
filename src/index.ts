import * as signin from './signin'

import { writeFileSync } from 'fs'
import { parseSyllabusPageHTML } from './content-parser'
import { search } from './search'

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

  const searchResult = await search(session, {
    'nenji': '2年',
    'jikanwariShozokuCode': '情報理工学域夜間主コース',
    'gakkiKubunCode': '前学期',
  })

  ;(() => {
    /* export it */
    const exp = searchResult.map(({contentHTML, ...values}, i) => {
      return {
        ...values,
        contentTree: (() => {
          try {
            console.log(`Parsing ${i+1} / ${searchResult.length} …`)
            return parseSyllabusPageHTML(contentHTML)
          } catch (e) {
            console.error(e)
            return null
          }
        })(),
        contentHTML,
      }
    })
    writeFileSync('./syllabus.json', JSON.stringify(exp, null, 2), {encoding: 'utf8'})
  })()
}

main().catch(e => console.error(e))
