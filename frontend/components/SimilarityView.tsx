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
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import { InlineIcon } from './ui'
import WithTableSchema from './WithTableSchema'
import withRequestLock from './withRequestLock'
import useDelayedEffect from './useDelayedEffect'

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

  return (
    <Box display="flex" flexDirection="column" {...flexItem}>
      <WithTableSchema client={client} hasUploaded={hasUploaded} table={table} view={view} tableConfig={tableConfig}>
        {({ schema }) => {
          if (!hasSelection) {
            return (
              <Box display="flex" flexGrow={1} alignItems="center" justifyContent="center">
                <Text
                  className="aito-ui"
                  variant="paragraph"
                  textColor="#bbb"
                  size="xlarge"
                  fontWeight="bold"
                  margin={0}
                  flexGrow={0}
                >
                  Please select a record
                </Text>
              </Box>
            )
          }

          return (
            <Box flexGrow={1} height="0px" overflow="auto">
              {selectedRecordCount > maxRecords && (
                <Text fontStyle="oblique" textColor="light" variant="paragraph">
                  Showing similar records for {maxRecords} of the {selectedRecordCount} selected records.
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
          )
        }}
      </WithTableSchema>
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
      const cellValue = record.getCellValue(field)
      const aitoValue = conversion.toAitoValue(cellValue, field.config)
      if (aitoValue === null || aitoValue === undefined || aitoValue === false) {
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
  const aitoTableName = tableConfig.aitoTableName

  const viewport = useViewport()
  useWatchable(viewport, ['size'])

  type PredictionError = 'quota-exceeded' | 'empty-table' | 'error'

  const [predictionError, setPredictionError] = useState<PredictionError | null>(null)

  const [prediction, setPrediction] = useState<SimilarityHits | undefined | null>(undefined)
  useDelayedEffect(50, async (hasUnmounted) => {
    try {
      withRequestLock(async () => {
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
      })
    } catch (e) {
      if (!hasUnmounted()) {
        setPrediction(null)
      }
    }
  })

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
                      originalRecord={record}
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
  originalRecord: Record
  recordsQuery: TableOrViewQueryResult
  viewportWidth: number
  fields: Field[]
  attachment: Field | undefined
}> = ({ recordId, recordsQuery, fields, viewportWidth, originalRecord, attachment }) => {
  const record = useRecordById(recordsQuery, recordId)

  if (!record) {
    return (
      <Text>
        <em>This record is no longer part of the table</em>
      </Text>
    )
  }

  return (
    <RecordCard
      width={viewportWidth - 40}
      fields={fields}
      record={record}
      attachmentCoverField={attachment}
      expandRecordOptions={{ records: [originalRecord, record] }}
    />
  )
}

export default SimilarityView
