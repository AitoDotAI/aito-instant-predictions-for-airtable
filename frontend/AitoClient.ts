import { normalizeAitoUrl } from './credentials'
import { isTableSchema, TableSchema } from './schema/aito'

export type Value = null | boolean | number | string

export type AitoValue = Value | AitoRow

export interface AitoRow extends Record<string, AitoValue> {}

export type AitoError = 'quota-exceeded' | 'error'

export interface Hits<Hit = AitoRow> {
  total: number
  offset: number
  hits: Hit[]
}

export interface PredictionHit {
  $p: number
  feature: Value
}

export interface PredictQuery {
  from: string
  where?: Record<string, unknown>
  predict: unknown
  limit?: number
  offset?: number
}

export interface SearchQuery {
  from: string
  where?: Record<string, unknown>
  limit?: number
  offset?: number
}

type FetchParameters = Parameters<typeof fetch>[1]

const toAitoError = (response: Response): AitoError => {
  if (response.status === 429 && response.headers.get('x-error-cause') === 'Quota Exceeded') {
    return 'quota-exceeded'
  } else {
    return 'error'
  }
}

export const isAitoError = (value: unknown): value is AitoError => value === 'quota-exceeded' || value === 'error'

export default class AitoClient {
  constructor(host: string, key: string) {
    this.host = normalizeAitoUrl(host)
    this.key = key.trim()
  }

  private readonly host: string
  private readonly key: string

  get name(): string {
    try {
      return new URL(this.host).host.split('.')[0]
    } catch (e) {
      return this.host
    }
  }

  async getSchema(): Promise<Record<string, TableSchema> | AitoError> {
    const url = new URL(`/api/v1/schema`, this.host)
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
      headers: {
        'x-api-key': this.key,
      },
    })
    if (response.ok) {
      const body = await response.json()
      return Object.entries(body.schema).reduce((acc, [name, value]) => {
        if (isTableSchema(value)) {
          return { ...acc, [name]: value }
        } else {
          return acc
        }
      }, {} as Record<string, TableSchema>)
    }
    return toAitoError(response)
  }

  async getTableSchema(tableName: string): Promise<TableSchema | AitoError> {
    const name = encodeURIComponent(tableName)
    const url = new URL(`/api/v1/schema/${name}`, this.host)
    const response = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
      headers: {
        'x-api-key': this.key,
      },
    })
    if (response.ok) {
      const body = await response.json()
      if (isTableSchema(body)) {
        return body
      }
    }
    return toAitoError(response)
  }

  private body(method: string, body?: string): FetchParameters {
    return {
      method,
      mode: 'cors',
      headers: {
        'x-api-key': this.key,
        'content-type': 'application/json',
      },
      body,
    }
  }

  private post(...body: [string] | []): FetchParameters {
    return this.body('POST', ...body)
  }

  private put(...body: [string] | []): FetchParameters {
    return this.body('PUT', ...body)
  }

  private delete(...body: [string] | []): FetchParameters {
    return this.body('DELETE', ...body)
  }

  private async send(url: URL, params: FetchParameters): Promise<Response> {
    for (;;) {
      const response = await fetch(url.toString(), params)
      const errorCause = response.headers.get('x-error-cause')
      const isThrottled = response.status === 429 && errorCause == 'Throttled'
      if (isThrottled) {
        await new Promise((resolve) => setTimeout(() => resolve(0), Math.floor(250 + Math.random() * 500)))
      } else {
        return response
      }
    }
  }

  async predict(predictionJSON: string): Promise<Hits<PredictionHit> | AitoError> {
    const url = new URL(`/api/v1/_predict`, this.host)
    const response = await this.send(url, this.post(predictionJSON))
    if (response.ok) {
      return await response.json()
    } else {
      return toAitoError(response)
    }
  }

  async search(searchQuery: SearchQuery): Promise<Hits | AitoError> {
    const url = new URL(`/api/v1/_search`, this.host)
    const response = await this.send(url, this.post(JSON.stringify(searchQuery)))
    if (response.ok) {
      return await response.json()
    } else {
      return toAitoError(response)
    }
  }

  async createTable(tableName: string, tableSchema: unknown): Promise<'ok' | AitoError> {
    const url = new URL(`/api/v1/schema/${tableName}`, this.host)
    const response = await this.send(url, this.put(JSON.stringify(tableSchema)))
    if (response.ok) {
      return 'ok'
    } else {
      return toAitoError(response)
    }
  }

  async uploadBatch(tableName: string, rows: unknown[]): Promise<'ok' | AitoError> {
    const url = new URL(`/api/v1/data/${tableName}/batch`, this.host)
    const response = await this.send(url, this.post(JSON.stringify(rows)))
    if (response.ok) {
      return 'ok'
    } else {
      return toAitoError(response)
    }
  }

  async deleteTable(tableName: string): Promise<'ok' | AitoError> {
    const url = new URL(`/api/v1/schema/${tableName}`, this.host)
    const response = await this.send(url, this.delete())
    if (response.ok) {
      return 'ok'
    } else {
      return toAitoError(response)
    }
  }
}
