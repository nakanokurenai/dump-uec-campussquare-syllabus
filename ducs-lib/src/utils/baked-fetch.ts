import fetch, { Response, RequestInfo, RequestInit } from "node-fetch"
import toughCookie from "tough-cookie"
import { resolve } from "url"
import ProxyAgent from "proxy-agent"

const proxyAgent = new ProxyAgent("") // FIXME: undefined を本来渡せてよいのに型がおかしい. falsy かどうかのみ検査しているので空文字を渡してやる

type ArgumentsOf<T extends Function> = T extends (...args: infer T) => any
	? T
	: void

export type Fetch = (
	info: RequestInfo,
	init?: Omit<RequestInit, "headers"> & {
		headers?: { [k: string]: string }
	} & { credentials?: "omit" | "includes" }
) => Promise<Response>

const requestHeaderMiddleware = (headers: {
	[k: string]: string
}): RequestMiddleware => {
	return (info, init = {}) => [
		info,
		{
			...init,
			headers: {
				...(init.headers ? init.headers : {}),
				...headers,
			},
		},
	]
}

// (middlewares: ((...args: T) => T)[]) => T[]
const sameChain = <T extends Array<unknown>>(
	...chain: ((...args: T) => T)[]
) => {
	return (...fi: T): T => chain.reduce((i, h) => h(...i), fi)
}

type FetchMiddleware = (target: Fetch) => Fetch
const applyFetchMiddlewares = (middlewares: FetchMiddleware[]) => (
	target: Fetch
): Fetch => {
	const m = middlewares.map((m) => (f: Fetch): [Fetch] => [m(f)])
	return sameChain<[Fetch]>(...m)(target)[0]
}
type RequestMiddleware = (...args: ArgumentsOf<Fetch>) => ArgumentsOf<Fetch>
const applyRequestMiddlewares = (
	middlewares: RequestMiddleware[]
): FetchMiddleware => (target) => (info, init) => {
	const args = sameChain<ArgumentsOf<Fetch>>(...middlewares)(info, init)
	return target(...args)
}
type ResponseMiddleware = (
	response: Response,
	requestOptions: ArgumentsOf<Fetch>
) => void | Promise<void>
const applyResponseMiddlewares = (
	middlewares: ResponseMiddleware[]
): FetchMiddleware => (target) => (...req) => {
	return target(...req).then(async (r) => {
		for (const m of middlewares) {
			await m(r, req)
		}
		return r
	})
}

export const bakedFetch = (jar: toughCookie.CookieJar): Fetch =>
	applyFetchMiddlewares([
		applyRequestMiddlewares([
			(info, init) => {
				if (init && init.credentials !== "includes") return [info, init]
				const Cookie = jar.getCookieStringSync(info.toString())
				if (!Cookie.length) return [info, init]
				return requestHeaderMiddleware({
					Cookie,
				})(info, init)
			},
			(info, init = {}) => {
				console.log(`-> ${info.toString()}`)
				/*
				const headers = Array.from(
					Object.entries(init.headers || {})
				).reduce(
					(s, [k, v]) => s + (s.length ? `, ` : "") + `${k}=${v}`,
					""
				)
				console.log(`   headers: [${headers}]`)
				*/
				return [info, init]
			},
			(info, init = {}) => {
				return [
					info,
					{
						...init,
						// FIXME: ProxyAgent は指定がないときに環境変数から値を取得するが、どうも環境変数になにもセットされていなかったときにエラーでコケる
						// そんな挙動がなくなればいいが、本当はProxyAgent が正しく初期化されていないときに限って undefined を渡すようにしたい
						agent: process.env.ALL_PROXY ? proxyAgent : undefined,
					},
				]
			},
		]),
		applyResponseMiddlewares([
			(r) => {
				console.log(`<- ${r.status} ${r.statusText}`)
			},
			async (r, [, init]) => {
				if (r.ok) return
				if (init && init.body) {
					console.error(init.body)
				}
			},
			(r, [, init]) => {
				if (!init || init.credentials != "includes") return
				if (!r.headers.has("set-cookie")) return
				r.headers.raw()["set-cookie"].forEach((v) => {
					jar.setCookieSync(v, r.url)
				})
			},
		]),
		// redirecter, cookie をセットさせるため (redirect 無しを暗に期待しているので)
		(fetch) => async (info, init = {}) => {
			if (init.redirect && init.redirect === "manual")
				return fetch(info, init)
			var resp = await fetch(info, { ...init, redirect: "manual" })
			while (
				[301, 302].includes(resp.status) &&
				resp.headers.get("location")
			) {
				resp = await fetch(
					resolve(resp.url, resp.headers.get("location")!),
					{
						...init,
						method: "get",
						body: undefined,
						redirect: "manual",
					}
				)
			}
			return resp
		},
	])(fetch)
