import { Cursor, Field, FieldType, Record, Table, TableOrViewQueryResult } from '@airtable/blocks/models'
import {
  Box,
  CellRenderer,
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
import { isDocumentProposition, isHasProposition, isIsProposition, isSimpleProposition, Why } from '../explanations'
import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import { BORDER_STYLE, InlineFieldIcon, InlineIcon } from './ui'
import WithTableSchema from './WithTableSchema'
import { maxWidth } from 'styled-system'
import { Cell } from './table'

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
            { value: 'relate-in', label: 'Influenced by' },
            { value: 'relate-out', label: 'Influences' },
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
                  allFields={table.fields}
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
  allFields: Field[]
  mode: Mode
  tableConfig: TableConfig
  client: AitoClient
  schema: TableSchema
}> = ({ field, cellValues, visibleFields, allFields, mode, client, schema, tableConfig }) => {
  return (
    <Box marginBottom={3}>
      {cellValues.map((cellValue, i) => (
        <FieldValueRelations
          key={i}
          field={field}
          mode={mode}
          cellValue={cellValue}
          visibleFields={visibleFields}
          allFields={allFields}
          tableConfig={tableConfig}
          client={client}
          schema={schema}
        />
      ))}
    </Box>
  )
}

const PropositionToCellValue = (
  proposition: unknown,
  fields: Field[],
  tableConfig: TableConfig,
): [Field, unknown] | null => {
  if (isDocumentProposition(proposition)) {
    const entries = Object.entries(proposition)
    const firstEntry = entries[0]
    const fieldName = firstEntry[0]
    const simpleProposition = firstEntry[1]
    if (fieldName && isSimpleProposition(simpleProposition)) {
      const config = Object.entries(tableConfig.columns).find(([, column]) => column.name === fieldName)
      if (!config) {
        return null
      }
      const [fieldId] = config

      const field = fields.find((field) => field.id === fieldId)
      if (!field) {
        return null
      }

      const conversion = AcceptedFields[field.type]
      if (!conversion) {
        return null
      }

      if (isHasProposition(simpleProposition)) {
        const { $has } = simpleProposition
        return [field, conversion.toCellValue($has, field.config)]
      }
      if (isIsProposition(simpleProposition)) {
        const { $is } = simpleProposition
        return [field, conversion.toCellValue($is, field.config)]
      }
    }
  }
  return null
}

const SpacedCellRenderer: React.FC<{
  field: Field
  cellValue: unknown
}> = ({ field, cellValue }) => {
  if (cellValue === null) {
    return (
      <Text margin={2}>
        <em>empty</em>
      </Text>
    )
  }

  let margin: number = 0
  if (field.type === FieldType.SINGLE_SELECT || field.type === FieldType.BUTTON) {
    margin = 2
  }
  if (field.type === FieldType.CHECKBOX) {
    margin = 2
  }

  return <CellRenderer field={field} margin={margin} cellValue={cellValue} />
}

const FieldValueRelations: React.FC<{
  field: Field
  cellValue: unknown
  visibleFields: Field[]
  allFields: Field[]
  tableConfig: TableConfig
  schema: TableSchema
  mode: Mode
  client: AitoClient
}> = ({ field, cellValue, allFields, visibleFields, mode, schema, client, tableConfig }) => {
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
          select: ['related', 'condition', 'lift', 'fs', 'ps', 'info'],
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
      <Box marginX={3} marginTop={3} marginBottom={2} paddingBottom={0} borderBottom="thin solid lightgray">
        <Text style={{ textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}>
          <InlineFieldIcon field={field} />
          <strong>{field.name}</strong>
        </Text>
        <SpacedCellRenderer field={field} cellValue={cellValue} />
      </Box>
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
              const converted = PropositionToCellValue(
                mode === 'relate-in' ? condition : related,
                allFields,
                tableConfig,
              )
              if (!converted) {
                return null
              }
              const [relatedField, relatedValue] = converted

              const pOnCondition = ps && ps.pOnCondition

              return (
                <React.Suspense key={i} fallback={<Spinner />}>
                  <Box marginTop={2} marginX={3}>
                    <Text textColor="light">
                      <InlineFieldIcon fillColor="#aaa" field={relatedField} />
                      {relatedField.name}
                    </Text>
                    <CellRenderer field={relatedField} cellValue={relatedValue} />
                  </Box>
                </React.Suspense>
              )
            }))}
      </Box>
    </Box>
  )
}

export default RelateView
