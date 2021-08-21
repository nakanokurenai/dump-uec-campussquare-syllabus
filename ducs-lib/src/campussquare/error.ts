// 「ページの有効期限ぎれ」などを判定
export const isErrorHTML = (html: string): Promise<boolean> => Promise.resolve(html.includes("sys-err"))
