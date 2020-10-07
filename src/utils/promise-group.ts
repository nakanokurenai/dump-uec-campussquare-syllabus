export class PromiseGroup<T> {
	readonly capacity: number
	constructor(cap: number) {
		this.capacity = cap
	}
	private promises: Promise<T>[] = []
	private tasks: (() => Promise<T>)[] = []
	private fulfilled: number[] = []
	enqueue(task: () => Promise<T>) {
		this.tasks.push(task)
	}
	async acquire() {
		// 追加できるなら task を実行
		const addTask = () => {
			const task = this.tasks.pop()
			if (!task) {
				console.log('task を取得しようとしたが、失敗した')
				return
			}
			const len = this.promises.length
			// filter がめっちゃ時間かかるけどまぁいいか
			this.promises.push(task().finally(() => { this.fulfilled.push(len) }))
		}
		if (this.capacity > (this.promises.length-this.fulfilled.length)) {
			return addTask()
		}
		// 追加できないなら race してから追加
		const nonFulfilled = this.promises.filter((_, i) => !this.fulfilled.includes(i))
		if (!nonFulfilled.length) throw new Error("unreachable code")
		await Promise.race(nonFulfilled)
		return addTask()
	}
	async all(): Promise<T[]> {
		return Promise.all(this.promises)
	}
	// utility
	async allFulfilled(): Promise<T[]> {
		return Promise.all(this.promises.filter((_, i) => this.fulfilled.includes(i)))
	}
}
