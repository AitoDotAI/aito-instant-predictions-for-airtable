import { useEffect, useState } from 'react'
import AitoClient, { isAitoError } from '../AitoClient'
import { TableSchema } from '../schema/aito'

const useAitoSchema = (
  aitoTableName: string,
  client: AitoClient,
): TableSchema | undefined | null | 'quota-exceeded' => {
  // Load aito schema after brief delay

  const [schema, setSchema] = useState<TableSchema | undefined | null | 'quota-exceeded'>(undefined)
  useEffect(() => {
    let cancel = false
    const loadSchema = async () => {
      try {
        const response = await client.getSchema()
        if (!cancel) {
          if (isAitoError(response)) {
            if (response === 'quota-exceeded') {
              setSchema('quota-exceeded')
            } else {
              setSchema(null)
            }
          } else {
            const tableSchema = response[aitoTableName] || null
            setSchema(tableSchema)
          }
        }
      } catch (e) {
        if (!cancel) {
          setSchema(null)
        }
      }
    }

    const delay = 100
    const timeout = setTimeout(loadSchema, delay)

    return () => {
      cancel = true
      clearTimeout(timeout)
    }
  }, [aitoTableName, setSchema, client])

  return schema
}

export default useAitoSchema
