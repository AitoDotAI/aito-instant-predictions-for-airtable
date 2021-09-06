import { normalizeAitoUrl } from './credentials'
import { isTableSchema, TableSchema } from './schema/aito'

export type Value = null | boolean | number | string

export type AitoValue = Value | AitoRow

export interface AitoRow extends Record<string, AitoValue> {}

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

  async getTableSchema(tableName: string): Promise<TableSchema | undefined> {
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
  }

  private body(method: string, body?: unknown): Parameters<typeof fetch>[1] {
    return {
      method,
      mode: 'cors',
      headers: {
        'x-api-key': this.key,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  }

  private post(...body: [unknown] | []): Parameters<typeof fetch>[1] {
    return this.body('POST', ...body)
  }

  private put(...body: [unknown] | []): Parameters<typeof fetch>[1] {
    return this.body('PUT', ...body)
  }

  private delete(...body: [unknown] | []): Parameters<typeof fetch>[1] {
    return this.body('DELETE', ...body)
  }

  async predict(prediction: PredictQuery): Promise<Hits<PredictionHit> | undefined> {
    const url = new URL(`/api/v1/_predict`, this.host)
    const response = await fetch(url.toString(), this.post(prediction))
    if (response.ok) {
      return await response.json()
    }
  }

  async search(searchQuery: SearchQuery): Promise<Hits | undefined> {
    const url = new URL(`/api/v1/_search`, this.host)
    const response = await fetch(url.toString(), this.post(searchQuery))
    if (response.ok) {
      return await response.json()
    }
  }

  async createTable(tableName: string, tableSchema: unknown): Promise<unknown> {
    const url = new URL(`/api/v1/schema/${tableName}`, this.host)
    const response = await fetch(url.toString(), this.put(tableSchema))
    if (response.ok) {
      return await response.json()
    }
  }

  async uploadBatch(tableName: string, rows: unknown[]): Promise<number> {
    const url = new URL(`/api/v1/data/${tableName}/batch`, this.host)
    const response = await fetch(url.toString(), this.post(rows))
    return response.status
  }

  async deleteTable(tableName: string): Promise<unknown> {
    const url = new URL(`/api/v1/schema/${tableName}`, this.host)
    const response = await fetch(url.toString(), this.delete())
    if (response.ok) {
      return await response.json()
    }
  }
}
