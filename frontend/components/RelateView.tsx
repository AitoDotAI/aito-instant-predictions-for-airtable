import { Cursor, Field, FieldType, Record, Table, TableOrViewQueryResult } from '@airtable/blocks/models'
import {
  Box,
  expandRecord,
  RecordCard,
  SelectButtons,
  Text,
  useLoadable,
  useRecordById,
  useRecords,
  useViewMetadata,
  useViewport,
  useWatchable,
} from '@airtable/blocks/ui'
import _, { values } from 'lodash'
import React, { useEffect, useState } from 'react'
import { useMemo } from 'react'
import { useRef } from 'react'
import AcceptedFields from '../AcceptedFields'
import AitoClient, { AitoValue, isAitoError, RelateHits } from '../AitoClient'
import { mapColumnNames } from '../functions/inferAitoSchema'
import { TableSchema } from '../schema/aito'
import { TableConfig } from '../schema/config'
import Semaphore from 'semaphore-async-await'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import { BORDER_STYLE, InlineIcon } from './ui'
import WithTableSchema from './WithTableSchema'

const PARALLEL_REQUESTS = 10
const REQUEST_TIME = 750
const RequestLocks = new Semaphore(PARALLEL_REQUESTS)

type Mode = 'relate-out' | 'relate-in'

const RelateView: React.FC<
  {
    table: Table
    cursor: Cursor
    tableConfig: TableConfig
    client: AitoClient
    hasUploaded: boolean
  } & FlexItemSetProps
> = ({ table, cursor, tableConfig, client, hasUploaded, ...flexItem }) => {
  // Make sure that the selected rows and fields are up to date

  const view = cursor.activeViewId ? table.getViewById(cursor.activeViewId) : null
  const metadata = useViewMetadata(view)
  const visibleFields = metadata?.visibleFields || []

  const recordsQuery = table.selectRecords({ fields: cursor.selectedFieldIds })

  useLoadable([recordsQuery, cursor])

  useWatchable(cursor, ['selectedFieldIds', 'selectedRecordIds'])
  useWatchable(table, ['fields'])
  useWatchable(recordsQuery, ['recordIds', 'records'])

  const maxRecords = 10
  const recordIdsToRelate = _.take(cursor.selectedRecordIds, maxRecords)

  const selectedFieldCount = cursor.selectedFieldIds.length
  const selectedRecordCount = cursor.selectedRecordIds.length
  const hasSelection = selectedFieldCount > 0 && selectedRecordCount > 0

  // Fetch subset of records
  const selectedRecords = recordIdsToRelate
    .map((recordId) => recordsQuery.getRecordByIdIfExists(recordId))
    .filter((x): x is Record => Boolean(x))

  useWatchable(selectedRecords, ['cellValues'])

  const [mode, setMode] = useState<Mode>('relate-in')

  const selectedFields = cursor.selectedFieldIds.reduce<Field[]>((acc, fieldId) => {
    const field = table.getFieldByIdIfExists(fieldId)
    if (field) {
      return [...acc, field]
    } else {
      return acc
    }
  }, [])

  const maxFieldValues = 10

  const selectedFieldValues = selectedFields.reduce<Array<[Field, ...unknown[]]>>((acc, field) => {
    let fieldValueCount = 0
    const cellValues = selectedRecords.reduce<unknown[]>((acc2, record) => {
      const cellValue = record.getCellValue(field)
      if (fieldValueCount == maxFieldValues || acc2.find((previousValue) => _.isEqual(cellValue, previousValue))) {
        return acc2
      } else {
        fieldValueCount += 1
        return [...acc2, cellValue]
      }
    }, [])

    if (cellValues.length > 0) {
      return [...acc, [field, ...cellValues]]
    } else {
      return acc
    }
  }, [])

  return (
    <Box display="flex" flexDirection="column" {...flexItem}>
      <Box
        borderBottom={BORDER_STYLE}
        display="flex"
        backgroundColor="#f7f7f7"
        flexDirection="row"
        flexGrow={0}
        flexShrink={0}
      >
        <SelectButtons
          value={mode}
          options={[
            { value: 'relate-in', label: 'Relate-in' },
            { value: 'relate-out', label: 'Relate-out' },
          ]}
          size="small"
          onChange={(newMode) => setMode(newMode as Mode)}
        />
      </Box>

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
                  Please select a cell
                </Text>
              </Box>
            )
          }

          return (
            <Box flexGrow={1} height="0px" overflow="auto" key={mode}>
              {selectedRecordCount > maxRecords && (
                <Text fontStyle="oblique" textColor="light" variant="paragraph">
                  Showing similar records for {maxRecords} of the {selectedRecordCount} selected records.
                </Text>
              )}
              {selectedFieldValues.map(([field, ...cellValues], i) => (
                <RelationGroup
                  key={field.id + '-' + JSON.stringify(cellValues)}
                  mode={mode}
                  field={field}
                  cellValues={cellValues}
                  visibleFields={visibleFields}
                  tableConfig={tableConfig}
                  client={client}
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

const RelationGroup: React.FC<{
  field: Field
  cellValues: unknown[]
  visibleFields: Field[]
  mode: Mode
  tableConfig: TableConfig
  client: AitoClient
  schema: TableSchema
}> = ({ field, cellValues, visibleFields, mode, client, schema, tableConfig }) => {
  return (
    <Box marginBottom={3}>
      <Text
        marginX={3}
        marginTop={3}
        marginBottom={2}
        paddingBottom={2}
        borderBottom="thin solid lightgray"
        textTransform="uppercase"
        style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}
      >
        {field.name} {mode === 'relate-in' ? 'is affected by' : 'affects'}
      </Text>
      {cellValues.map((cellValue, i) => (
        <FieldValueRelations
          key={i}
          field={field}
          mode={mode}
          cellValue={cellValue}
          visibleFields={visibleFields}
          tableConfig={tableConfig}
          client={client}
          schema={schema}
        />
      ))}
    </Box>
  )
}

const FieldValueRelations: React.FC<{
  field: Field
  cellValue: unknown
  visibleFields: Field[]
  tableConfig: TableConfig
  schema: TableSchema
  mode: Mode
  client: AitoClient
}> = ({ field, cellValue, visibleFields, mode, schema, client, tableConfig }) => {
  const delayedRequest = useRef<ReturnType<typeof setTimeout> | undefined>()
  const aitoTableName = tableConfig.aitoTableName

  type PredictionError = 'quota-exceeded' | 'empty-table' | 'error'

  const [predictionError, setPredictionError] = useState<PredictionError | null>(null)

  const [prediction, setPrediction] = useState<RelateHits | undefined | null>(undefined)
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

        const fieldProposition = {
          [tableConfig.columns[field.id].name]: AcceptedFields[field.type].toAitoValue(cellValue, field.config),
        }

        const otherFieldsProposition = {
          $exists: visibleFields
            .map((f) => (f.id !== field.id && tableConfig.columns[f.id] ? tableConfig.columns[f.id].name : null))
            .filter(Boolean),
        }

        const query = JSON.stringify({
          from: aitoTableName,
          where: mode === 'relate-in' ? otherFieldsProposition : fieldProposition,
          //select: ['related', 'condition', 'lift', 'fs'],
          relate: mode === 'relate-in' ? fieldProposition : otherFieldsProposition,
          limit,
          orderBy: 'info.miTrue',
        })

        start = new Date()
        const result = await client.relate(query)

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
            prediction.hits.map(({ related, condition, fs, info, lift, ps, relation }, i) => {
              return (
                <React.Suspense key={i} fallback={<Spinner />}>
                  <Box marginY={2} marginX={3}>
                    <Text>related: {JSON.stringify(related)}</Text>
                    <Text>condition: {JSON.stringify(condition)}</Text>
                    <Text>fs: {JSON.stringify(fs)}</Text>
                    <Text>info: {JSON.stringify(info)}</Text>
                    <Text>lift: {JSON.stringify(lift)}</Text>
                    <Text>ps: {JSON.stringify(ps)}</Text>
                    <Text>relation: {JSON.stringify(relation)}</Text>
                  </Box>
                </React.Suspense>
              )
            }))}
      </Box>
    </Box>
  )
}

export default RelateView
