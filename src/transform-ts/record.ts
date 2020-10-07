import { Transformer, ok, error, isError, ValidationError } from 'transform-ts'

export const record = <Key extends keyof any, Value>(keyTransformer: Transformer<any, Key>, valueTransformer: Transformer<unknown, Value>) => Transformer.from<unknown, Record<Key, Value>>(u => {
	const toError = (e: Error) => error(ValidationError.from(e))
	if (typeof u !== "object") {
		return toError(new Error("not object passed"))
	}
	if (!u) return toError(new Error("not a object"))
	const o: Partial<Record<Key, Value>> = {}
	for (const [key, value] of Object.entries(u)) {
		const kr = keyTransformer.transform(key)
		if (isError(kr)) {
			return kr
		}
		const vr = valueTransformer.transform(value)
		if (isError(vr)) {
			return vr
		}
		o[kr.value] = vr.value
	}
	return ok(o as Record<Key, Value>)
})
