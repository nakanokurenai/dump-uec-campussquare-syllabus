export type PromiseType<P extends Promise<any>> = P extends Promise<infer T>
	? T
	: unknown
