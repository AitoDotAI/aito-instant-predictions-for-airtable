import { Cursor, Field, FieldType, Record, Table, TableOrViewQueryResult } from '@airtable/blocks/models'
import {
  Box,
  expandRecord,
  RecordCard,
  Text,
  useLoadable,
  useRecordById,
  useViewMetadata,
  useViewport,
  useWatchable,
} from '@airtable/blocks/ui'
import _ from 'lodash'
import React, { useEffect, useState } from 'react'
import { useMemo } from 'react'
import { useRef } from 'react'
import AcceptedFields from '../AcceptedFields'
import AitoClient, { AitoValue, isAitoError } from '../AitoClient'
import { mapColumnNames } from '../functions/inferAitoSchema'
import { TableSchema } from '../schema/aito'
import { TableConfig } from '../schema/config'
import Semaphore from 'semaphore-async-await'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import { InlineIcon } from './ui'
import useAitoSchema from './useAitoSchema'

const PARALLEL_REQUESTS = 10
const REQUEST_TIME = 750
const RequestLocks = new Semaphore(PARALLEL_REQUESTS)

const SimilarityView: React.FC<
  {
    table: Table
    cursor: Cursor
    tableConfig: TableConfig
    client: AitoClient
    hasUploaded: boolean
  } & FlexItemSetProps
> = ({ table, cursor, tableConfig, client, hasUploaded, ...flexItem }) => {
  useWatchable(cursor, ['selectedFieldIds', 'selectedRecordIds'])

  // Use the current view for predictions, not necessarily the one used for training/upload
  const view = cursor.activeViewId ? table.getViewByIdIfExists(cursor.activeViewId) : null
  const metadata = useViewMetadata(view)
  const visibleFields = metadata?.visibleFields || []

  const aitoTableName = tableConfig.aitoTableName
  const tableColumnMap = tableConfig.columns

  const schema = useAitoSchema(aitoTableName, client)

  // Make sure that the selected rows and fields are up to date
  const recordsQuery = useMemo(() => table.selectRecords(), [table])
  useLoadable([cursor, metadata, recordsQuery])

  const selectedFieldCount = cursor.selectedFieldIds.length
  const selectedRecordCount = cursor.selectedRecordIds.length
  const hasSelection = selectedFieldCount > 0 && selectedRecordCount > 0

  const maxRecords = 10
  const recordIdsToPredict = _.take(cursor.selectedRecordIds, maxRecords)

  const selectedRecords = recordIdsToPredict
    .map((recordId) => recordsQuery.getRecordByIdIfExists(recordId))
    .filter((x): x is Record => Boolean(x))

  const fieldsToDisplay = cursor.selectedFieldIds.reduce<Field[]>((acc, fieldId) => {
    const field = table.getFieldByIdIfExists(fieldId)
    if (field) {
      return [...acc, field]
    } else {
      return acc
    }
  }, [])

  if (schema === 'quota-exceeded') {
    return (
      <Box padding={3} {...flexItem}>
        <QueryQuotaExceeded />
      </Box>
    )
  }

  if (!schema || !hasUploaded) {
    if (schema === null || !hasUploaded) {
      // No table with that name
      return (
        <Box padding={3} {...flexItem}>
          <Text variant="paragraph" textColor="light">
            There doesn&apos;t seem to be any training data for <em>{table.name}</em> in your Aito instance. Please
            upload training data first by clicking on the button at the bottom.
          </Text>
        </Box>
      )
    } else {
      // Still loading table, show nothing
      return <Spinner />
    }
  }

  const currentTableColumnMap = metadata ? mapColumnNames(metadata.visibleFields) : {}
  const isSchemaOutOfSync = !!Object.entries(currentTableColumnMap).find(([fieldId, { type }]) => {
    const uploaded = tableColumnMap[fieldId]
    return uploaded && uploaded.type !== type
  })

  if (isSchemaOutOfSync) {
    return (
      <Box padding={3} display="flex" {...flexItem}>
        <Text variant="paragraph" flexGrow={0}>
          <InlineIcon flexGrow={0} name="warning" aria-label="Warning" fillColor="#aaa" />
        </Text>

        <Text variant="paragraph" flexGrow={1}>
          The fields have changed since training data was last uploaded to Aito. Please retrain the model.
        </Text>
      </Box>
    )
  }

  if (!hasSelection) {
    return (
      <Box padding={3} display="flex" alignItems="center" justifyContent="center" flexBasis="100%" {...flexItem}>
        <Box>
          <Text variant="paragraph" textColor="#bbb" size="xlarge" fontWeight="bold" margin={0} flexGrow={0}>
            Please select a record
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box display="flex" flexDirection="column" {...flexItem}>
      <Box height="0px" overflow="auto" flexGrow={1} flexShrink={1}>
        {selectedRecordCount > maxRecords && (
          <Text fontStyle="oblique" textColor="light" variant="paragraph" marginX={3} marginTop={3}>
            Showing predictions for {maxRecords} of the {selectedRecordCount} selected records.
          </Text>
        )}
        {recordIdsToPredict.map((recordId) => (
          <RecordSimilarityGroup
            key={recordId}
            recordId={recordId}
            selectedRecords={selectedRecords}
            viewFields={visibleFields}
            tableConfig={tableConfig}
            fieldsToDisplay={fieldsToDisplay}
            client={client}
            recordsQuery={recordsQuery}
            schema={schema}
          />
        ))}
      </Box>
    </Box>
  )
}

const RecordSimilarityGroup: React.FC<{
  recordsQuery: TableOrViewQueryResult
  recordId: string
  selectedRecords: Record[]
  viewFields: Field[]
  tableConfig: TableConfig
  fieldsToDisplay: Field[]
  client: AitoClient
  schema: TableSchema
}> = ({ recordId, selectedRecords, recordsQuery, viewFields, fieldsToDisplay, client, schema, tableConfig }) => {
  const record = useRecordById(recordsQuery, recordId)

  if (!record) {
    return null
  }

  const openRecord = () => expandRecord(record, { records: selectedRecords })

  return (
    <Box marginBottom={3}>
      <Text
        marginX={3}
        marginTop={3}
        marginBottom={2}
        paddingBottom={2}
        borderBottom="thin solid lightgray"
        style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}
      >
        <span style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={openRecord}>
          <InlineIcon name="expand" />
          <strong>{record.name}</strong>
        </span>
      </Text>
      <RecordSimilarity
        record={record}
        fields={viewFields}
        recordsQuery={recordsQuery}
        fieldsToDisplay={fieldsToDisplay}
        tableConfig={tableConfig}
        client={client}
        schema={schema}
      />
    </Box>
  )
}

const makeWhereClause = (fields: Field[], schema: TableSchema, record: Record) => {
  const fieldIdToName = mapColumnNames(fields)
  return fields.reduce<globalThis.Record<string, unknown>>((acc, field) => {
    const conversion = AcceptedFields[field.type]
    const columnName = fieldIdToName[field.id].name
    if (conversion && columnName in schema.columns) {
      const isEmpty = record.getCellValueAsString(field) === '' && field.type !== FieldType.CHECKBOX
      const aitoValue = conversion.toAitoValue(field, record)
      if (aitoValue === null || aitoValue === undefined || isEmpty) {
        return acc
      } else {
        return {
          [columnName]: aitoValue === null ? null : conversion.toAitoQuery(aitoValue, field.config),
          ...acc,
        }
      }
    } else {
      return acc
    }
  }, {})
}

interface SimilarityHits {
  hits: {
    $score: number
    id?: AitoValue
    $why?: Why
  }[]
}

const RecordSimilarity: React.FC<{
  record: Record
  fields: Field[]
  tableConfig: TableConfig
  schema: TableSchema
  client: AitoClient
  recordsQuery: TableOrViewQueryResult
  fieldsToDisplay: Field[]
}> = ({ fields, record, schema, client, tableConfig, recordsQuery, fieldsToDisplay }) => {
  const delayedRequest = useRef<ReturnType<typeof setTimeout> | undefined>()

  const aitoTableName = tableConfig.aitoTableName

  const viewport = useViewport()
  useWatchable(viewport, ['size'])

  type PredictionError = 'quota-exceeded' | 'empty-table' | 'error'

  const [predictionError, setPredictionError] = useState<PredictionError | null>(null)

  const [prediction, setPrediction] = useState<SimilarityHits | undefined | null>(undefined)
  useEffect(() => {
    if (delayedRequest.current !== undefined) {
      return
    }

    // Start a new request
    const delay = 50

    const hasUnmounted = () => delayedRequest.current === undefined

    delayedRequest.current = setTimeout(async () => {
      let start: Date | undefined
      try {
        await RequestLocks.acquire()

        if (hasUnmounted()) {
          return
        }

        const limit = 6

        const where = makeWhereClause(fields, schema, record)
        let query = JSON.stringify({
          from: aitoTableName,
          select: ['$score', 'id', '$why'],
          limit,
        })

        // HACK: enforce decimal points
        let whereString = JSON.stringify(where)
        Object.entries(schema.columns).forEach(([columnName, columnSchema]) => {
          if (columnSchema.type.toLowerCase() === 'decimal') {
            const fieldName = JSON.stringify(columnName)
            whereString = whereString.replace(
              new RegExp(`([{,]${fieldName}:(?:{"\\$numeric":)?)(-?\\d+)([,}])`),
              `$1$2.0$3`,
            )
          }
        })
        query = query.replace(/}$/, `,"similarity":${whereString}}`)

        start = new Date()
        const result = await client.similarity(query)

        if (!hasUnmounted()) {
          if (isAitoError(result)) {
            setPrediction(null)
            if (result === 'quota-exceeded') {
              setPredictionError('quota-exceeded')
            } else {
              setPredictionError('error')
            }
          } else {
            if (result.hits.length === 0) {
              setPredictionError('empty-table')
            }
            setPrediction(result)
          }
        }
      } catch (e) {
        if (!hasUnmounted()) {
          setPrediction(null)
        }
      } finally {
        // Delay releasing the request lock until
        if (start) {
          const elapsed = new Date().valueOf() - start.valueOf()
          const remaining = Math.min(REQUEST_TIME, REQUEST_TIME - elapsed)
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(() => resolve(undefined), remaining))
          }
        }
        RequestLocks.release()
      }
    }, delay)

    return () => {
      if (delayedRequest.current) {
        clearTimeout(delayedRequest.current)
        delayedRequest.current = undefined
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hitRecordIds = _.take(
    (prediction?.hits || []).filter(({ id }) => id !== record.id),
    5,
  )

  const attachment = fields.find((field) => field.type === FieldType.MULTIPLE_ATTACHMENTS)
  const otherFields = fields.filter((field) => !fieldsToDisplay.find((displayField) => displayField.id === field.id))

  return (
    <Box paddingBottom={3} position="relative">
      <Box>
        {predictionError && (
          <Box marginX={3}>
            {predictionError === 'empty-table' && (
              <Text variant="paragraph">It seems there are no records in the training set.</Text>
            )}
            {predictionError === 'quota-exceeded' && <QueryQuotaExceeded />}
            {predictionError === 'error' && <Text variant="paragraph">Unable to predict.</Text>}
          </Box>
        )}

        {(!predictionError && prediction === undefined && <Spinner />) ||
          (prediction &&
            hitRecordIds.map(({ id: recordId }) => {
              if (typeof recordId !== 'string') {
                return null
              }

              return (
                <React.Suspense key={recordId} fallback={<Spinner />}>
                  <Box marginY={2} marginX={3}>
                    <SimilarityCellRenderer
                      recordId={recordId}
                      viewportWidth={viewport.size.width}
                      fields={[...fieldsToDisplay, ...otherFields]}
                      attachment={attachment}
                      recordsQuery={recordsQuery}
                    />
                  </Box>
                </React.Suspense>
              )
            }))}
      </Box>
    </Box>
  )
}

const SimilarityCellRenderer: React.FC<{
  recordId: string
  recordsQuery: TableOrViewQueryResult
  viewportWidth: number
  fields: Field[]
  attachment: Field | undefined
}> = ({ recordId, recordsQuery, fields, viewportWidth, attachment }) => {
  const record = useRecordById(recordsQuery, recordId)

  if (!record) {
    return (
      <Text>
        <em>This record is no part of the table</em>
      </Text>
    )
  }

  return <RecordCard width={viewportWidth - 40} fields={fields} record={record} attachmentCoverField={attachment} />
}

export default SimilarityView
