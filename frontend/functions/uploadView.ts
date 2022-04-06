import { Base, Field, FieldType, ViewMetadataQueryResult } from '@airtable/blocks/models'
import _ from 'lodash'
import AcceptedFields, { isDataField, isIgnoredField } from '../AcceptedFields'
import AitoClient, { AitoError, AitoValue, isAitoError, Value } from '../AitoClient'
import { isColumnSchema, TableSchema } from '../schema/aito'
import { TableColumnMap } from '../schema/config'
import { isArrayOf, isObjectOf, isString } from '../validator/validation'
import inferAitoSchema, { mapColumnNames } from './inferAitoSchema'

export type UploadResult = SuccessfulUploadResult | ErrorUploadResult

interface SuccessfulUploadResult {
  type: 'success'
  tasks: UploadTask[]
}

interface ErrorUploadResult {
  type: 'error'
  tasks: UploadTask[]
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

export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'error'

export interface TableInfo {
  aitoTable: string
  fieldIdToName: TableColumnMap
  schema: TableSchema
}

export interface TaskCommon {
  status: TaskStatus
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
  tableId: string
  viewId: string
  recordCount?: number
}

export interface UploadLinkTask extends TaskCommon {
  type: 'upload-link'
  tableInfo: TableInfo
  tableId: string
  viewId: string
  linkFieldId: string
  fromAitoTable: string
  toAitoTable: string
  linkCount?: number
}

export type UploadTask = CreateTableTask | CreateLinkTask | UploadTableTask | UploadLinkTask

interface LinkInfo {
  linkFieldId: string
  tableId: string
  viewId: string
  aitoTable: string
}

const cloneTasks = (tasks: UploadTask[]): UploadTask[] => tasks.map((x) => ({ ...x }))

export async function describeTasks(
  base: Base,
  mainTableId: string,
  mainViewId: string,
  aitoTable: string,
  linkViews: LinkInfo[],
): Promise<UploadTask[]> {
  // create new table with new schema

  const unloadables: ViewMetadataQueryResult[] = []

  try {
    const mainTable = base.getTableById(mainTableId)
    const mainView = mainTable.getViewById(mainViewId)
    const mainMetadata = await mainView.selectMetadataAsync()
    unloadables.push(mainMetadata)

    const mainFields: Field[] = mainMetadata.visibleFields.filter((x) => !isIgnoredField(x))
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
      const { linkFieldId, tableId, viewId, aitoTable: linkedAitoTable } = link

      if (!createdViewsSet.has(viewId)) {
        // Create schema for referenced view
        createdViewsSet.add(viewId)

        const linkedTable = base.getTableById(tableId)
        const linkedView = linkedTable.getViewById(viewId)
        const metadata = await linkedView.selectMetadataAsync()
        unloadables.push(metadata)

        const fields = metadata.visibleFields.filter(isDataField)

        const fieldIdToName = mapColumnNames(fields)
        const schema = inferAitoSchema(fields, fieldIdToName)

        const tableInfo: TableInfo = {
          aitoTable: linkedAitoTable,
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

      const linkTableName = aitoTable + '_' + field.id
      const schema = makeLinkTableSchema(aitoTable, linkedAitoTable)
      const tableInfo: TableInfo = {
        aitoTable: linkTableName,
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
        linkFieldId: linkFieldId,
        fromAitoTable: aitoTable,
        toAitoTable: linkedAitoTable,
        tableInfo,
        status: 'pending',
      })
    }

    return [...createTableTasks, ...createLinkTasks, ...uploadTableTasks, ...uploadLinkTasks]
  } finally {
    unloadables.forEach((metadata) => metadata.unloadData())
  }
}

const findLinksTo = (schema: Record<string, TableSchema>, tableName: string): string[] => {
  const result: string[] = []
  for (const tableEntry of Object.entries(schema)) {
    const [name, tableSchema] = tableEntry
    for (const columSchema of Object.values(tableSchema.columns)) {
      const link = columSchema.link
      if (link) {
        const targetTable = link.substring(0, link.indexOf('.'))
        if (targetTable === tableName) {
          result.push(name)
          break
        }
      }
    }
  }
  return result
}

export async function runUploadTasks(
  base: Base,
  client: AitoClient,
  tasks: UploadTask[],
  onProgress: (status: UploadTask[]) => void,
): Promise<UploadResult> {
  tasks = cloneTasks(tasks)

  const report = () => onProgress(cloneTasks(tasks))

  const schema = await client.getSchema()
  if (isAitoError(schema)) {
    return { type: 'error', tasks, error: schema }
  }

  for (const task of tasks) {
    task.status = 'in-progress'
    report()

    switch (task.type) {
      case 'create-table':
      case 'create-link': {
        const info = task.tableInfo

        task.progress = 0.1
        report()
        try {
          if (info.aitoTable in schema) {
            // We don't expect these link tables to have links in turn
            const linkTables = findLinksTo(schema, info.aitoTable)
            for (const dependent of linkTables) {
              await client.deleteTable(dependent)
            }
            await client.deleteTable(info.aitoTable)
          }
        } catch (e) {
          console.error('Failed to delete existing table', e)
          task.status = 'error'
          report()
          return { type: 'error', tasks, error: 'error' }
        }
        task.progress = 0.5
        report()

        try {
          const response = await client.createTable(info.aitoTable, info.schema)
          if (isAitoError(response)) {
            task.status = 'error'
            report()
            return { type: 'error', tasks, error: response }
          }
          task.progress = 1.0
        } catch (e) {
          console.error('Failed to create table schema', e)
          task.status = 'error'
          report()
          throw e
        }
        task.status = 'done'
        break
      }

      case 'upload-table': {
        const { tableId, viewId } = task
        const fieldMap = task.tableInfo.fieldIdToName
        const tableName = task.tableInfo.aitoTable

        try {
          const uploadResponse = await fetchRecordsAndUpload(
            client,
            base,
            tableId,
            viewId,
            fieldMap,
            tableName,
            (progress) => {
              task.progress = progress
              report()
            },
          )

          if (isAitoError(uploadResponse)) {
            task.status = 'error'
            report()
            return { type: 'error', tasks, error: uploadResponse }
          }

          const response = await client.search({
            from: tableName,
            limit: 0,
          })

          if (!isAitoError(response)) {
            task.recordCount = Number(response.total)
            task.status = 'done'
          } else {
            task.status = 'error'
            report()
            return { type: 'error', tasks, error: response }
          }
        } catch (e) {
          task.status = 'error'
          report()
          console.error('Failed to upload records', e)
          return { type: 'error', tasks, error: 'error' }
        }
        break
      }

      case 'upload-link': {
        const { tableId, viewId, linkFieldId, toAitoTable, fromAitoTable } = task
        const tableName = task.tableInfo.aitoTable

        try {
          const uploadResponse = await fetchRecordLinkssAndUpload(
            client,
            base,
            tableId,
            viewId,
            linkFieldId,
            tableName,
            fromAitoTable,
            toAitoTable,
            (progress) => {
              task.progress = progress
              report()
            },
          )

          if (isAitoError(uploadResponse)) {
            task.status = 'error'
            report()
            return { type: 'error', tasks, error: uploadResponse }
          }

          const response = await client.search({
            from: tableName,
            limit: 0,
          })

          if (isAitoError(response)) {
            task.status = 'error'
            report()
            return { type: 'error', tasks, error: response }
          }
          task.linkCount = Number(response.total)
          task.status = 'done'
        } catch (e) {
          task.status = 'error'
          report()
          console.error('Failed to upload links', e)
          return { type: 'error', tasks, error: 'error' }
        }
        break
      }
    }
    report()
  }

  return { type: 'success', tasks }
}

async function uploadInBatches(
  client: AitoClient,
  dataArray: Array<any>,
  aitoTable: string,
  onProgress: (progress: number) => unknown,
): Promise<AitoError | undefined> {
  // Upload to Aito in batches of batchSize
  const batchSize = 1000
  const chunkedData = _.chunk(dataArray, batchSize)
  let uploadedRecords = 0

  for (const dataChunk of chunkedData) {
    const status = await client.uploadBatch(aitoTable, dataChunk)

    if (isAitoError(status)) {
      return status
    }

    uploadedRecords += dataChunk.length
    onProgress(uploadedRecords / dataArray.length)
  }
}

async function fetchRecordsAndUpload(
  client: AitoClient,
  base: Base,
  tableId: string,
  viewId: string,
  fieldIdToName: TableColumnMap,
  aitoTable: string,
  onProgress: (progress: number) => unknown,
): Promise<AitoError | undefined> {
  const table = base.getTableById(tableId)
  const view = table.getViewById(viewId)
  const queryResult = await view.selectRecordsAsync()

  try {
    const metadata = await view.selectMetadataAsync()

    try {
      const dataArray: any[] = []
      for (const record of queryResult.records) {
        const row = metadata.visibleFields.reduce<Record<string, Value>>((row, field) => {
          if (!isDataField(field)) {
            return row
          }

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
        }, { id: record.id })
        dataArray.push(row)
        if (dataArray.length % 100 === 0) {
          // Yield back to event loop
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      }

      const error = uploadInBatches(client, dataArray, aitoTable, onProgress)
      if (error) {
        return error
      }
    } finally {
      metadata.unloadData()
    }
  } finally {
    queryResult.unloadData()
  }
}

const isArrayOfIds = isArrayOf(isObjectOf({ id: isString }))

async function fetchRecordLinkssAndUpload(
  client: AitoClient,
  base: Base,
  tableId: string,
  viewId: string,
  linkFieldId: string,
  linkAitoTable: string,
  fromAitoTable: string,
  toAitoTable: string,
  onProgress: (progress: number) => unknown,
): Promise<AitoError | undefined> {
  const table = base.getTableById(tableId)
  const view = table.getViewById(viewId)
  const queryResult = await view.selectRecordsAsync({
    fields: [linkFieldId],
  })

  try {
    const dataArray: Record<string, AitoValue>[] = []
    for (const record of queryResult.records) {
      const recordId = record.id
      const linkedRecords = record.getCellValue(linkFieldId)

      if (isArrayOfIds(linkedRecords)) {
        for (const link of linkedRecords) {
          const { id } = link
          dataArray.push({
            [fromAitoTable]: recordId,
            [toAitoTable]: id,
          })

          if (dataArray.length % 100 === 0) {
            // Yield back to event loop
            await new Promise((resolve) => setTimeout(resolve, 1))
          }
        }
      }
    }
    const error = uploadInBatches(client, dataArray, linkAitoTable, onProgress)
    if (error) {
      return error
    }
  } finally {
    queryResult.unloadData()
  }
}
