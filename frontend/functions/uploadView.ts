import { Field, FieldType, View } from '@airtable/blocks/models'
import _ from 'lodash'
import AcceptedFields from '../AcceptedFields'
import AitoClient, { AitoError, isAitoError, Value } from '../AitoClient'
import { TableColumnMap } from '../schema/config'
import inferAitoSchema, { mapColumnNames } from './inferAitoSchema'

export type UploadResult = SuccessfulUploadResult | ErrorUploadResult

interface SuccessfulUploadResult {
  type: 'success'
  rowCount: number
  columns: TableColumnMap
}

interface ErrorUploadResult {
  type: 'error'
  error: AitoError
}

export async function uploadView(client: AitoClient, view: View, aitoTable: string): Promise<UploadResult> {
  // delete old table in aito (to overwrite it again).
  try {
    await client.deleteTable(aitoTable)
  } catch (e) {
    /* OK, it might not have existed */
  }

  // infer schema from the selected columns of data
  const metadata = await view.selectMetadataAsync()

  // create new table with new schema
  try {
    const visibleFields = metadata.visibleFields
    const fieldIdToName = mapColumnNames(visibleFields)
    const mySchema = inferAitoSchema(visibleFields, fieldIdToName)

    await client.createTable(aitoTable, mySchema)

    // upload data
    await fetchRecordsAndUpload(client, view, visibleFields, fieldIdToName, aitoTable)

    // check and log row count
    var response = await client.search({
      from: aitoTable,
      limit: 0,
    })

    if (!isAitoError(response)) {
      return { type: 'success', rowCount: response.total, columns: fieldIdToName }
    } else {
      return { type: 'error', error: response }
    }
  } catch (e) {
    console.error(e)
  } finally {
    metadata.unloadData()
  }
  return { type: 'error', error: 'error' }
}

async function fetchRecordsAndUpload(
  client: AitoClient,
  view: View,
  visibleFields: Field[],
  fieldIdToName: TableColumnMap,
  aitoTable: string,
): Promise<void> {
  const queryResult = await view.selectRecordsAsync()
  try {
    const dataArray: any[] = []
    for (const record of queryResult.records) {
      const row = visibleFields.reduce<Record<string, Value>>((row, field) => {
        const conversion = AcceptedFields[field.type]

        const columnName = fieldIdToName[field.id].name

        let columnValue: string | number | boolean | null
        if (!conversion || !conversion.isValid(field, record)) {
          console.error(
            `The value for record ${record.id} is not valid according to the field schema. Type is ${field.type}. Setting to null.`,
          )
          columnValue = null
        } else if (field.type !== FieldType.CHECKBOX && record.getCellValueAsString(field) === '') {
          columnValue = null
        } else {
          columnValue = conversion.toAitoValue(field, record)
        }

        if (columnValue === null) {
          return row
        } else {
          return {
            [columnName]: columnValue,
            ...row,
          }
        }
      }, {})
      dataArray.push(row)
      if (dataArray.length % 100 === 0) {
        // Yield back to event loop
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    }

    // Upload to Aito in batches of batchSize
    const batchSize = 1000
    const chunkedData = _.chunk(dataArray, batchSize)
    let batchNumber = 1

    for (const dataChunk of chunkedData) {
      const start = Date.now()
      const status = await client.uploadBatch(
        aitoTable,
        dataChunk.map((c) => _.omit(c, 'AirTableId')),
      )
      const duration = Date.now() - start
      console.log(`Batch ${batchNumber++} finished with HttpStatus(${status}) after ${duration}ms`)
    }
  } finally {
    queryResult.unloadData()
  }
}
