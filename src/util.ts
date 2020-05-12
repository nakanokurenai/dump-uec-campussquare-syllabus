export const convertFormElementsToPlainObject = (form: HTMLFormElement, { submitName, selectByOptionInnerText: select }: { submitName?: string, selectByOptionInnerText?: Record<string, string> } = {}): Record<string, string> => {
  const elements = Array.from(form.elements) as HTMLInputElement[]
  return elements.reduce((acc, el) => {
    if (['select-one', 'select-multiple'].includes(el.type) && select && el.name in select) {
      const options = Array.from((el as any as HTMLSelectElement).options)
      console.dir(options)
      const opt = options.find(o => o.textContent?.trim() === select[el.name])
      if (!opt) throw new Error(`該当するオプションがありません: ${select[el.name]}`)
      return {
        ...acc,
        [el.name]: opt.value
      }
    }
    if (el.type === 'submit' && submitName && el.name !== submitName) {
      return acc
    }
    return {
      ...acc,
      [el.name]: el.value
    }
  }, {} as Record<string, string>) 
}
