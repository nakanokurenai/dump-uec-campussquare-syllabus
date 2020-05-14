import { JSDOM } from 'jsdom'

import fetch, { Response, RequestInfo, RequestInit } from "node-fetch";
import toughCookie from "tough-cookie";

import { convertFormElementsToPlainKeyValueObject } from './util'

import { resolve } from 'url'

import { readFileSync, writeFileSync } from 'fs'

type ArgumentsOf<T extends Function> = T extends (...args: infer T) => any
  ? T
  : void;

export type Fetch = (
  info: RequestInfo,
  init?: Omit<RequestInit, "headers"> & {
    headers?: { [k: string]: string };
  } & { credentials?: "omit" | "includes" }
) => Promise<Response>;

const requestHeaderMiddleware = (headers: {
  [k: string]: string;
}): RequestMiddleware => {
  return (info, init = {}) => [
    info,
    {
      ...init,
      headers: {
        ...(init.headers ? init.headers : {}),
        ...headers
      }
    }
  ];
};

// (middlewares: ((...args: T) => T)[]) => T[]
const sameChain = <T extends Array<unknown>>(
  ...chain: ((...args: T) => T)[]
) => {
  return (...fi: T): T => chain.reduce((i, h) => h(...i), fi);
};

type FetchMiddleware = (target: Fetch) => Fetch;
const applyFetchMiddlewares = (middlewares: FetchMiddleware[]) => (
  target: Fetch
): Fetch => {
  const m = middlewares.map(m => (f: Fetch): [Fetch] => [m(f)]);
  return sameChain<[Fetch]>(...m)(target)[0];
};
type RequestMiddleware = (...args: ArgumentsOf<Fetch>) => ArgumentsOf<Fetch>;
const applyRequestMiddlewares = (
  middlewares: RequestMiddleware[]
): FetchMiddleware => target => (info, init) => {
  const args = sameChain<ArgumentsOf<Fetch>>(...middlewares)(info, init);
  return target(...args);
};
type ResponseMiddleware = (
  response: Response,
  requestOptions: ArgumentsOf<Fetch>
) => void | Promise<void>;
const applyResponseMiddlewares = (
  middlewares: ResponseMiddleware[]
): FetchMiddleware => target => (...req) => {
  return target(...req).then(async r => {
    for (const m of middlewares) {
      await m(r, req);
    }
    return r;
  });
};

const bakedFetch = (jar: toughCookie.CookieJar): Fetch =>
  applyFetchMiddlewares([
    applyRequestMiddlewares([
      (info, init) => {
        if (init && init.credentials !== "includes") return [info, init];
        const Cookie = jar.getCookieStringSync(info.toString());
        if (!Cookie.length) return [info, init];
        return requestHeaderMiddleware({
          Cookie
        })(info, init);
      },
      (info, init = {}) => {
        console.log(`-> ${info.toString()}`);
        const headers = Array.from(Object.entries(init.headers || {})).reduce(
          (s, [k, v]) => s + (s.length ? `, ` : "") + `${k}=${v}`,
          ""
        );
        console.log(`   headers: [${headers}]`);
        return [info, init];
      }
    ]),
    applyResponseMiddlewares([
      r => {
        console.log(`<- ${r.status} ${r.statusText}`);
      },
      async (r, [, init]) => {
        if (r.ok) return;
        if (init && init.body) {
          console.error(init.body);
        }
      },
      (r, [, init]) => {
        if (!init || init.credentials != "includes") return;
        if (!r.headers.has("set-cookie")) return;
        r.headers.raw()["set-cookie"].forEach(v => {
          jar.setCookieSync(v, r.url);
        });
      }
    ]),
    // redirecter, cookie をセットさせるため (redirect 無しを暗に期待しているので)
    (fetch) => async (info, init = {}) => {
      if (init.redirect && init.redirect === 'manual') return fetch(info, init)
      var resp = await fetch(info, {...init, redirect: 'manual'})
      while (([301, 302]).includes(resp.status) && resp.headers.get('location')) {
        resp = await fetch(resolve(resp.url, resp.headers.get('location')!), {
          ...init,
          method: 'get',
          body: undefined,
          redirect: 'manual',
        })
      }
      return resp
    }
  ])(fetch);

const jarSym = Symbol()

export const createSession = (): Fetch => {
  const jar = (() => {
    try {
      const z = JSON.parse(readFileSync('./credentials.json', { encoding: 'utf8' }))
      return toughCookie.CookieJar.deserializeSync(z)
    } catch (e) {
      console.error(e)
      return new toughCookie.CookieJar()
    }
  })()

  const baked = bakedFetch(jar)
  const session: Fetch = (...args) => baked(...args)
  Object.defineProperty(session, jarSym, {
    configurable: false,
    enumerable: false,
    value: jar,
    writable: false,
  })
  return session
}

export const exportSession = async (fetch: Fetch) => {
  const jar: toughCookie.CookieJar = (fetch as any)[jarSym]
  const sz = jar.serializeSync()
  writeFileSync('./credentials.json', JSON.stringify(sz))
}

const CAMPUS_SQUARE_SSO_ROOT = 'https://campusweb.office.uec.ac.jp/campusweb/ssologin.do'

export const isLoggedIn = async (fetch: Fetch) => {
  const sso = await fetch(CAMPUS_SQUARE_SSO_ROOT, { credentials: 'includes' })
  return (new URL(sso.url)).hostname === 'campusweb.office.uec.ac.jp'
}

export const login = async (fetch: Fetch, username: string, password: string, mfaCodePrompt?: () => Promise<number>) => {
  const url = new URL(CAMPUS_SQUARE_SSO_ROOT)

  const sso = await fetch(url, {
    credentials: 'includes',
  })

  if ((new URL(sso.url)).hostname !== 'shibboleth.cc.uec.ac.jp') {
    throw new Error('shibboleth にリダイレクトされませんでした。もうログイン済みかもしれません')
  }

  const { window: { document } } = new JSDOM(await sso.text())
  const form = document.forms[0]

  const input = convertFormElementsToPlainKeyValueObject(form)
  input['j_username'] = username
  input['j_password'] = password

  var resp = await fetch(resolve(sso.url, form.action), {
    method: 'post',
    body: new URLSearchParams(input).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes'
  })

  if (resp.url.includes('/mfa/MFAuth.php')) {
    if (!mfaCodePrompt) {
      throw new Error('二段階認証が必要です。引数が足りていません')
    }
    const mfaCode = await mfaCodePrompt()
    const { window: { document } } = new JSDOM(await resp.text())
    const mfaForm = document.forms[0]
    const mfaInput = convertFormElementsToPlainKeyValueObject(mfaForm, { submitName: 'login' })
    mfaInput['authcode'] = mfaCode.toString(10)
    resp = await fetch(resolve(resp.url, mfaForm.action), {
      method: 'post',
      body: new URLSearchParams(mfaInput).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      credentials: 'includes'
    })
  }

  const redirectText = await resp.text()
  if (!resp.url.includes('/idp/profile/SAML2/Redirect/SSO')) {
    console.error(redirectText)
    throw new Error('失敗してそう')
  }

  const { window: { document: redirectDocument } } = new JSDOM(redirectText)
  const redirectForm = redirectDocument.forms[0]
  const redirectResp = await fetch(resolve(resp.url, redirectForm.action), {
    method: 'post',
    body: new URLSearchParams(convertFormElementsToPlainKeyValueObject(redirectForm)).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    credentials: 'includes'
  })

  if ((new URL(redirectResp.url)).hostname !== 'campusweb.office.uec.ac.jp') {
    console.error(await redirectResp.text())
    throw new Error('なんか失敗しちゃった……')
  }

  return
}
