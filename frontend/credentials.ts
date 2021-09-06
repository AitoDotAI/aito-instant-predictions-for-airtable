const rootUrl = (url: URL): URL => new URL(`${url.protocol}//${url.host}`)

export const normalizeAitoUrl = (instance: string): string => {
  try {
    const url = new URL(instance)
    return rootUrl(url).href
  } catch (e) {
    try {
      if (instance.match(/\./)) {
        return rootUrl(new URL(`https://${instance}`)).href
      } else {
        return rootUrl(new URL(`https://${instance}.aito.app`)).href
      }
    } catch (e2) {
      return 'invalid instance URL'
    }
  }
}

export const areValidCredentials = async (instance: string, key: string): Promise<boolean> => {
  const url = normalizeAitoUrl(instance)
  const schema = new URL('/api/v1/schema', url)

  // Validate by fetching schema
  const response = await fetch(schema.href, {
    method: 'GET',
    mode: 'cors',
    headers: {
      'x-api-key': key,
    },
  })

  return response.ok
}
