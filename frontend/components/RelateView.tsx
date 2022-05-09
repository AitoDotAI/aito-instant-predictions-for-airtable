import { Cursor, Field, FieldConfig, FieldType, Record, Table } from '@airtable/blocks/models'
import {
  Box,
  CellRenderer,
  colors,
  colorUtils,
  expandRecord,
  SelectButtons,
  Text,
  useBase,
  useLoadable,
  useRecordById,
  useViewMetadata,
  useWatchable,
} from '@airtable/blocks/ui'
import _ from 'lodash'
import React, { useEffect, useState } from 'react'
import { useRef } from 'react'
import AcceptedFields from '../AcceptedFields'
import AitoClient, { isAitoError, RelateHits } from '../AitoClient'
import { TableSchema } from '../schema/aito'
import { TableConfig } from '../schema/config'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { isDocumentProposition, isHasProposition, isIsProposition, isSimpleProposition } from '../explanations'
import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import { BORDER_STYLE, Clickable, InlineFieldIcon, InlineIcon } from './ui'
import WithTableSchema from './WithTableSchema'
import { isArrayOf, isObjectOf, isString, ValidatedType } from '../validator/validation'
import renderCellDefault from './renderCellDefault'
import PopupContainer from './PopupContainer'
import withRequestLock from './withRequestLock'
import useDelayedEffect from './useDelayedEffect'

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

const isArrayOfIds = isArrayOf(isObjectOf({ id: isString }))
type ArrayOfIds = ValidatedType<typeof isArrayOfIds>

const LinkCellRendererHelper: React.FC<{
  table: Table
  field: Field
  cellValue: ArrayOfIds
}> = ({ field, table, cellValue }) => {
  const id = (cellValue[0] && cellValue[0].id) || ''
  const record = useRecordById(table, id)
  const enrichedCellValue = [{ id, name: record?.name }]

  if (record) {
    return (
      <Clickable onClick={() => expandRecord(record)}>
        <SpacedCellRenderer field={field} cellValue={enrichedCellValue} />
      </Clickable>
    )
  } else {
    return <SpacedCellRenderer field={field} cellValue={cellValue} />
  }
}

const green = colorUtils.getHexForColor(colors.GREEN_DARK_1)
const red = colorUtils.getHexForColor(colors.RED_DARK_1)
const UpArrow = () => (
  <Box display="inline-block" paddingRight="2px">
    <InlineIcon fillColor={green} name="up" marginX={-1} />
  </Box>
)
const DownArrow = () => (
  <Box display="inline-block">
    <InlineIcon fillColor={red} name="down" marginX={-2} />
  </Box>
)

const ArrowScore: React.FC<{ score: number }> = ({ score }) => {
  if (score < -2.0) {
    return (
      <Box marginX={1}>
        <DownArrow />
        <DownArrow />
        <DownArrow />
      </Box>
    )
  } else if (score < -0.5) {
    return (
      <Box marginX={1}>
        <DownArrow />
        <DownArrow />
      </Box>
    )
  } else if (score < 0.0) {
    return (
      <Box marginX={1}>
        <DownArrow />
      </Box>
    )
  } else if (score <= 0.5) {
    return (
      <Box marginX={1}>
        <UpArrow />
      </Box>
    )
  } else if (score <= 2.0) {
    return (
      <Box marginX={1}>
        <UpArrow />
        <UpArrow />
      </Box>
    )
  } else {
    return (
      <Box marginX={1}>
        <UpArrow />
        <UpArrow />
        <UpArrow />
      </Box>
    )
  }
}

const LinkCellRenderer: React.FC<{
  field: Field & { config: FieldConfig & { type: FieldType.MULTIPLE_RECORD_LINKS } }
  cellValue: unknown
}> = ({ field, cellValue }) => {
  const base = useBase()
  const table = base.getTableByIdIfExists(field.config.options.linkedTableId)

  if (table && isArrayOfIds(cellValue)) {
    return <LinkCellRendererHelper field={field} cellValue={cellValue} table={table} />
  } else {
    return <SpacedCellRenderer field={field} cellValue={cellValue} />
  }
}

const SpacedCellRenderer: React.FC<{
  field: Field
  cellValue: unknown
}> = ({ field, cellValue }) => {
  if (cellValue === null || cellValue === false) {
    return (
      <Text padding={2} height="32px">
        <em>empty</em>
      </Text>
    )
  }

  let margin: number = 0
  if (field.type === FieldType.SINGLE_SELECT || field.type === FieldType.CHECKBOX) {
    margin = 2
  }
  if (field.type === FieldType.BUTTON) {
    margin = 1
  }

  const renderFallback = renderCellDefault(field)

  return (
    <Box minHeight="32px" padding={margin}>
      <CellRenderer field={field} cellValue={cellValue} renderInvalidCellValue={renderFallback} />
    </Box>
  )
}

const RelateCellRenderer: React.FC<{
  field: Field
  cellValue: unknown
}> = ({ field, cellValue }) => {
  if (field.config.type === FieldType.MULTIPLE_RECORD_LINKS) {
    return <LinkCellRenderer field={field as any} cellValue={cellValue} />
  } else {
    return <SpacedCellRenderer field={field} cellValue={cellValue} />
  }
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
  const aitoTableName = tableConfig.aitoTableName

  type PredictionError = 'quota-exceeded' | 'empty-table' | 'unknown-field' | 'error'

  const [predictionError, setPredictionError] = useState<PredictionError | null>(null)

  const [prediction, setPrediction] = useState<RelateHits | undefined | null>(undefined)
  useDelayedEffect(50, async (hasUnmounted) => {
    const fieldIdToName = tableConfig.columns

    const columnName = fieldIdToName[field.id]?.name
    if (!(columnName in schema.columns)) {
      setPrediction(null)
      setPredictionError('unknown-field')
      return
    }

    try {
      await withRequestLock(async () => {
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
      })
    } catch (e) {
      if (!hasUnmounted()) {
        setPrediction(null)
      }
    }
  })

  return (
    <Box paddingBottom={3}>
      <Box marginX={3} marginTop={3} marginBottom={0} paddingBottom={0} borderBottom="thin solid lightgray">
        <Text style={{ textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}>
          <InlineFieldIcon field={field} />
          <strong>{field.name}</strong>
        </Text>
        <RelateCellRenderer field={field} cellValue={cellValue} />
      </Box>
      <Box position="relative" paddingTop={2}>
        {predictionError && (
          <Box marginX={3}>
            {predictionError === 'empty-table' && (
              <Text variant="paragraph">It seems there are no records in the training set.</Text>
            )}
            {predictionError === 'quota-exceeded' && <QueryQuotaExceeded />}
            {predictionError === 'unknown-field' &&
              ((field.type === FieldType.BUTTON && (
                <Text variant="paragraph">Button fields can not be predicted.</Text>
              )) ||
                (field.type === FieldType.MULTIPLE_LOOKUP_VALUES && (
                  <Text variant="paragraph">Lookup fields can not be predicted.</Text>
                )) ||
                (field.type === FieldType.MULTIPLE_ATTACHMENTS && (
                  <Text variant="paragraph">Attachment fields can not be predicted.</Text>
                )) || (
                  <Text variant="paragraph">This field is not part of the training set and cannot be predicted.</Text>
                ))}
            {predictionError === 'error' && <Text variant="paragraph">Unable to predict {field.name}.</Text>}
          </Box>
        )}

        {(!predictionError && prediction === undefined && <Spinner />) ||
          (prediction &&
            prediction.hits.map(({ related, condition, lift }, i) => {
              const convertedRelated = PropositionToCellValue(related, allFields, tableConfig)
              if (!convertedRelated) {
                return null
              }

              const [relatedField, relatedValue] = convertedRelated

              const convertedCondition = PropositionToCellValue(condition, allFields, tableConfig)

              if (!convertedCondition) {
                return null
              }

              const [conditionField, conditionValue] = convertedCondition

              const listField = mode === 'relate-in' ? conditionField : relatedField
              const listValue = mode === 'relate-in' ? conditionValue : relatedValue

              const score = Math.log(lift || 1) / Math.log(2)

              const hitCount = prediction.hits.length
              const hitsBoxHeight = -8 + (49.5 + 8) * hitCount
              const beforeFraction = ((49.5 + 8) * i) / hitsBoxHeight
              const afterFraction = (hitsBoxHeight - (i + 1) * (49.5 + 8)) / hitsBoxHeight

              return (
                <React.Suspense key={i} fallback={<Spinner />}>
                  <Box display="flex" marginX={3} marginBottom={2} alignItems="start">
                    <Box flexGrow={0} flexShrink={0} flexBasis="48px">
                      <ArrowScore score={score} />
                    </Box>
                    <Box
                      display="flex"
                      flexGrow={1}
                      borderBottom={i + 1 === prediction.hits.length ? null : 'thin solid lightgray'}
                    >
                      <Box flexGrow={1} flexShrink={1}>
                        <Text textColor="light">
                          <InlineFieldIcon fillColor="#aaa" field={relatedField} />
                          {listField.name}
                        </Text>
                        <RelateCellRenderer field={listField} cellValue={listValue} />
                      </Box>
                      <Box flexGrow={0} flexShrink={0}>
                        <PopupContainer>
                          <Box display="flex" height="100%" justifyContent="right">
                            <InlineIcon
                              alignSelf="center"
                              name="help"
                              aria-label="Info"
                              fillColor="#aaa"
                              marginLeft={2}
                              marginRight={2}
                            />
                            <Box
                              className="popup"
                              position="absolute"
                              marginTop={2}
                              top={0}
                              marginLeft={2}
                              minWidth="200px"
                              right={4}
                              marginRight={3}
                            >
                              <Box display="flex" flexDirection="column" minHeight={`${hitsBoxHeight}px`}>
                                <Box flexShrink={beforeFraction} flexGrow={beforeFraction}></Box>
                                <Box
                                  flexShrink={0}
                                  flexGrow={0}
                                  flexBasis="auto"
                                  textColor="white"
                                  backgroundColor="dark"
                                  borderRadius="default"
                                  padding={2}
                                >
                                  <Text textColor="white">
                                    When <em>{conditionField.name}</em> is
                                    <RelateCellRenderer field={conditionField} cellValue={conditionValue} />
                                    then <em>{relatedField.name}</em> is {lift?.toFixed(2)} times more likely to be
                                    <RelateCellRenderer field={relatedField} cellValue={relatedValue} />
                                  </Text>
                                </Box>
                                <Box flexShrink={afterFraction} flexGrow={afterFraction}></Box>
                              </Box>
                            </Box>
                          </Box>
                        </PopupContainer>
                      </Box>
                    </Box>
                  </Box>
                </React.Suspense>
              )
            }))}
      </Box>
    </Box>
  )
}

export default RelateView
