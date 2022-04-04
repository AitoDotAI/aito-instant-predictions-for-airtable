import { Base, Field, FieldType, View } from '@airtable/blocks/models'
import _ from 'lodash'
import AcceptedFields, { isIgnoredField } from '../AcceptedFields'
import AitoClient, { AitoError, isAitoError, Value } from '../AitoClient'
import { TableSchema } from '../schema/aito'
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

const makeLinkTableSchema = (fromTableName: string, toTableName: string): TableSchema => {
  return {
    type: 'table',
    columns: {
      [fromTableName]: {
        type: 'String',
        nullable: false,
        link: `${fromTableName}.id`,
      },
      [toTableName]: {
        type: 'String',
        nullable: false,
        link: `${toTableName}.id`,
      },
    },
  }
}

type Status = 'pending' | 'in-progress' | 'done' | 'error'

export interface TableInfo {
  aitoTable: string
  fieldIdToName: TableColumnMap
  schema: TableSchema
}

export interface TaskCommon {
  status: Status
  progress?: number
}

export interface CreateTableTask extends TaskCommon {
  type: 'create-table'
  tableInfo: TableInfo
  tableId: string
  viewId: string
}

export interface CreateLinkTask extends TaskCommon {
  type: 'create-link'
  tableInfo: TableInfo
  tableId: string
  viewId: string
  linkFieldId: string
}

export interface UploadTableTask extends TaskCommon {
  type: 'upload-table'
  tableInfo: TableInfo
  fieldIds: string[]
  tableId: string
  viewId: string
  records?: number
}

export interface UploadLinkTask extends TaskCommon {
  type: 'upload-link'
  tableInfo: TableInfo
  tableId: string
  viewId: string
  linkFieldId: string
  records?: number
}

export type UploadTask = CreateTableTask | CreateLinkTask | UploadTableTask | UploadLinkTask

interface LinkInfo {
  linkFieldId: string
  tableId: string
  viewId: string
  fields: Field[]
  aitoTable: string
}

const cloneTasks = (tasks: UploadTask[]): UploadTask[] => tasks.map((x) => ({ ...x }))

export function describeTasks(
  mainTableId: string,
  mainViewId: string,
  mainViewFields: Field[],
  aitoTable: string,
  linkViews: LinkInfo[],
): UploadTask[] {
  // create new table with new schema
  const mainFields: Field[] = mainViewFields
  const fieldIdToName = mapColumnNames(mainFields)
  const mainTableInfo: TableInfo = {
    aitoTable,
    fieldIdToName,
    schema: inferAitoSchema(mainFields, fieldIdToName),
  }
  const createTableTasks: CreateTableTask[] = [
    {
      type: 'create-table',
      status: 'pending',
      tableInfo: mainTableInfo,
      tableId: mainTableId,
      viewId: mainViewId,
    },
  ]
  const uploadTableTasks: UploadTableTask[] = [
    {
      type: 'upload-table',
      status: 'pending',
      fieldIds: mainFields.map((field) => field.id),
      tableInfo: mainTableInfo,
      tableId: mainTableId,
      viewId: mainViewId,
    },
  ]

  const createLinkTasks: CreateLinkTask[] = []
  const uploadLinkTasks: UploadLinkTask[] = []

  const createdViewsSet = new Set<string>()
  createdViewsSet.add(mainViewId)

  // Create schema for each linked table and for each link field
  for (const link of linkViews) {
    const { linkFieldId, tableId, viewId, fields, aitoTable } = link

    if (!createdViewsSet.has(viewId)) {
      // Create schema for referenced view
      createdViewsSet.add(viewId)

      const fieldIdToName = mapColumnNames(fields)
      const name = aitoTable
      const schema = inferAitoSchema(fields, fieldIdToName)

      const tableInfo: TableInfo = {
        aitoTable: name,
        fieldIdToName,
        schema: schema,
      }

      // register tasks
      createTableTasks.push({
        type: 'create-table',
        tableInfo,
        tableId,
        viewId,
        status: 'pending',
      })
      uploadTableTasks.push({
        type: 'upload-table',
        tableInfo,
        tableId,
        fieldIds: fields.map((field) => field.id),
        viewId,
        status: 'pending',
      })
    }

    const field = mainFields.find((field) => field.id === linkFieldId)
    if (!field) {
      throw new Error('Something went badly wrong')
    }
    const config = field.config
    if (config.type !== FieldType.MULTIPLE_RECORD_LINKS) {
      throw new Error('Something went badly wrong')
    }

    const name = aitoTable + '_L'
    const schema = makeLinkTableSchema(mainTableId, config.options.linkedTableId)
    const tableInfo: TableInfo = {
      aitoTable: name,
      schema,
      fieldIdToName: {},
    }

    createLinkTasks.push({
      type: 'create-link',
      tableId: mainTableId,
      viewId: mainViewId,
      linkFieldId,
      tableInfo,
      status: 'pending',
    })
    uploadLinkTasks.push({
      type: 'upload-link',
      tableId: mainTableId,
      viewId: mainViewId,
      linkFieldId,
      tableInfo,
      status: 'pending',
    })
  }

  return [...createTableTasks, ...createLinkTasks, ...uploadTableTasks, ...uploadLinkTasks]
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
