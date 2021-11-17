import { Cursor, Field, FieldType, Record, Table, TableOrViewQueryResult, ViewType } from '@airtable/blocks/models'
import {
  Box,
  Button,
  CellRenderer,
  ConfirmationDialog,
  Icon,
  Label,
  Loader,
  Switch,
  Text,
  Tooltip,
  useLoadable,
  useRecordById,
  useViewMetadata,
  useWatchable,
} from '@airtable/blocks/ui'
import _ from 'lodash'
import React, { useCallback, useEffect, useState } from 'react'
import { useMemo } from 'react'
import { useRef } from 'react'
import AcceptedFields from '../AcceptedFields'
import AitoClient, { isAitoError } from '../AitoClient'
import { mapColumnNames } from '../functions/inferAitoSchema'
import { TableSchema } from '../schema/aito'
import { TableColumnMap, TableConfig } from '../schema/config'
import { useLocalConfig } from '../LocalConfig'
import { isArrayOf, isMissing, isObjectOf, isString, ValidatedType } from '../validator/validation'
import { Cell, Row } from './table'
import Semaphore from 'semaphore-async-await'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import ExplanationBox, { DefaultExplanationBox } from './ExplanationBox'
import styled from 'styled-components'

const PARALLEL_REQUESTS = 10
const REQUEST_TIME = 750
const RequestLocks = new Semaphore(PARALLEL_REQUESTS)

const PopupContainer = styled.div`
  height: 100%;

  & .popup {
    height: 0;
    overflow: hidden;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease-in-out;
  }

  &:hover .popup {
    z-index: 1000;
    opacity: 1;
    height: auto;
    visibility: visible;
  }
`

const PredictView: React.FC<{
  table: Table
  cursor: Cursor
  tableConfig: TableConfig
  client: AitoClient
  hasUploaded: boolean
}> = ({ table, cursor, tableConfig, client, hasUploaded }) => {
  useWatchable(cursor, ['selectedFieldIds', 'selectedRecordIds'])

  // Use the current view for predictions, not necessarily the one used for training/upload
  const view = cursor.activeViewId ? table.getViewById(cursor.activeViewId) : null
  const metadata = useViewMetadata(view)
  const visibleFields = metadata?.visibleFields || []
  const [localConfig, setLocalConfig] = useLocalConfig()

  let savedAutoFill = false
  try {
    savedAutoFill = Boolean(localConfig.tables[table.id] && localConfig.tables[table.id].autoFill)
  } catch (e) {
    console.error(e)
  }

  const aitoTableName = tableConfig.aitoTableName
  const tableColumnMap = tableConfig.columns

  const schema = useAitoSchema(aitoTableName, client)

  const [autoFill, setAutoFill] = useState(savedAutoFill)

  const saveAutoFill = useCallback(
    (shouldAutoFill) => {
      setAutoFill(shouldAutoFill)
      setLocalConfig({
        ...localConfig,
        tables: {
          ...localConfig.tables,
          [table.id]: {
            ...localConfig.tables[table.id],
            autoFill: shouldAutoFill,
          },
        },
      })
    },
    [localConfig, setLocalConfig, setAutoFill, table.id],
  )

  // Make sure that the selected rows and fields are up to date
  const recordsQuery = useMemo(() => table.selectRecords(), [table])
  useLoadable([cursor, metadata])

  const canUpdate = table.checkPermissionsForUpdateRecords(cursor.selectedRecordIds.map((id) => ({ id })))

  const setCellValue = async (record: Record, field: Field, value: unknown): Promise<void> => {
    if (canUpdate) {
      await table.updateRecordAsync(record, { [field.id]: value })
    }
  }

  if (schema === 'quota-exceeded') {
    return (
      <Box padding={3}>
        <QueryQuotaExceeded />
      </Box>
    )
  }

  if (!schema || !hasUploaded) {
    if (schema === null || !hasUploaded) {
      // No table with that name
      return (
        <Box padding={3}>
          <Text variant="paragraph" textColor="light">
            There doesn&apos;t seem to be any training data for <em>{table.name}</em> in your Aito instance. Please
            upload training data first by clicking on the button at the bottom.
          </Text>
        </Box>
      )
    } else {
      // Still loading table, show nothing
      return (
        <Box padding={3} display="flex" width="100%" flexDirection="column" justifyItems="center" alignItems="center">
          <Loader scale={0.3} />
        </Box>
      )
    }
  }

  const selectedFieldCount = cursor.selectedFieldIds.length
  const selectedRecordCount = cursor.selectedRecordIds.length

  const hasSelection = selectedFieldCount > 0 && selectedRecordCount > 0

  if (view?.type !== ViewType.GRID) {
    return (
      <Box padding={3}>
        <Text variant="paragraph" textColor="light">
          Predictions are only available in <em>grid views</em>.
        </Text>
      </Box>
    )
  }

  if (!hasSelection) {
    return (
      <Box padding={3}>
        <Text variant="paragraph" textColor="light">
          Please select an empty cell
        </Text>
      </Box>
    )
  }

  const fieldsToPredict = cursor.selectedFieldIds.reduce<Field[]>((acc, fieldId) => {
    const field = table.getFieldByIdIfExists(fieldId)
    if (field) {
      return [...acc, field]
    } else {
      return acc
    }
  }, [])

  const currentTableColumnMap = metadata ? mapColumnNames(metadata.visibleFields) : {}
  const isSchemaOutOfSync = !!Object.entries(currentTableColumnMap).find(([fieldId, { type }]) => {
    const uploaded = tableColumnMap[fieldId]
    return uploaded && uploaded.type !== type
  })

  if (isSchemaOutOfSync) {
    return (
      <Box padding={3} display="flex">
        <Icon
          flexGrow={0}
          name="warning"
          aria-label="Warning"
          marginRight={2}
          style={{ verticalAlign: 'text-bottom', width: '1.5em', height: '1.5em' }}
        />

        <Text variant="paragraph" flexGrow={1}>
          The fields have changed since training data was last uploaded to aito. Please retrain the model.
        </Text>
      </Box>
    )
  }

  const maxRecords = 10

  return (
    <>
      <Tooltip
        shouldHideTooltipOnClick={true}
        placementX={Tooltip.placements.CENTER}
        placementY={Tooltip.placements.BOTTOM}
        style={{ height: 'auto', width: '240px', maxWidth: '300px', whiteSpace: 'normal' }}
        content="Use the top prediction to automatically fill an empty cell if the confidence is over 90%."
      >
        <Box borderBottom="thick">
          <Switch
            paddingX={3}
            disabled={!canUpdate.hasPermission}
            value={autoFill}
            onChange={saveAutoFill}
            label="Auto-fill cells when confidence >90%"
            backgroundColor="transparent"
          />
        </Box>
      </Tooltip>
      {cursor.selectedRecordIds.length > maxRecords && (
        <Text fontStyle="oblique" textColor="light" variant="paragraph" marginX={3} marginTop={3}>
          Showing predictions for {maxRecords} of the {cursor.selectedRecordIds.length} selected records.
        </Text>
      )}
      {_.take(cursor.selectedRecordIds, maxRecords).map((recordId, i) => (
        <RecordPrediction
          key={recordId}
          offset={i}
          recordId={recordId}
          viewFields={visibleFields}
          tableColumnMap={tableColumnMap}
          fieldsToPredict={fieldsToPredict}
          aitoTableName={aitoTableName}
          client={client}
          recordsQuery={recordsQuery}
          schema={schema}
          setCellValue={setCellValue}
          canUpdate={canUpdate.hasPermission}
          autoFill={autoFill && canUpdate.hasPermission}
        />
      ))}
    </>
  )
}

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

const RecordPrediction: React.FC<{
  offset: number
  recordsQuery: TableOrViewQueryResult
  recordId: string
  viewFields: Field[]
  tableColumnMap: TableColumnMap
  fieldsToPredict: Field[]
  client: AitoClient
  aitoTableName: string
  schema: TableSchema
  setCellValue: (record: Record, field: Field, value: unknown) => Promise<unknown>
  autoFill: boolean
  canUpdate: boolean
}> = ({
  offset,
  recordId,
  recordsQuery,
  viewFields,
  fieldsToPredict,
  aitoTableName,
  client,
  schema,
  setCellValue,
  autoFill,
  canUpdate,
  tableColumnMap,
}) => {
  const record = useRecordById(recordsQuery, recordId)

  if (!record) {
    return null
  }

  return (
    <Box padding={3} borderTop={offset > 0 ? 'thick' : null}>
      <Text fontWeight="strong" paddingBottom={2}>
        Record {record.name}
      </Text>
      {fieldsToPredict.map((field) => (
        <FieldPrediction
          key={field.id}
          record={record}
          fields={viewFields}
          tableColumnMap={tableColumnMap}
          aitoTableName={aitoTableName}
          client={client}
          schema={schema}
          selectedField={field}
          setCellValue={setCellValue}
          autoFill={autoFill}
          canUpdate={canUpdate}
        />
      ))}
    </Box>
  )
}

const isMultipleSelection = isArrayOf(
  isObjectOf({
    name: isString.or(isMissing),
    id: isString.or(isMissing),
  }),
)

type HasNameOrId = ValidatedType<typeof isMultipleSelection>[0]

const hasFeature = (record: Record, field: Field, feature: any): boolean => {
  const conversion = AcceptedFields[field.type]
  if (conversion) {
    const value = record.getCellValue(field)
    const convertedFeature = conversion.toCellValue(feature)
    return conversion.hasFeature(value, convertedFeature)
  }
  return false
}

const isSuitablePrediction = (field: Field): boolean =>
  [
    FieldType.SINGLE_LINE_TEXT,
    FieldType.EMAIL,
    FieldType.URL,
    FieldType.SINGLE_SELECT,
    FieldType.MULTIPLE_SELECTS,
    FieldType.SINGLE_COLLABORATOR,
    FieldType.MULTIPLE_COLLABORATORS,
    FieldType.PHONE_NUMBER,
    FieldType.CHECKBOX,
    FieldType.RATING,
    FieldType.LAST_MODIFIED_BY,
    FieldType.CREATED_BY,
  ].includes(field.type)

const isMultipleSelectField = (field: Field): boolean =>
  [
    FieldType.MULTIPLE_COLLABORATORS,
    FieldType.MULTIPLE_SELECTS,
    FieldType.RICH_TEXT,
    FieldType.MULTILINE_TEXT,
  ].includes(field.type)

const renderCellDefault = (cellValue: unknown): React.ReactElement => <>{String(cellValue)}</>

const makeWhereClause = (selectedField: Field, fields: Field[], schema: TableSchema, record: Record) => {
  const fieldIdToName = mapColumnNames(fields)
  return fields.reduce<globalThis.Record<string, unknown>>((acc, field) => {
    const conversion = AcceptedFields[field.type]
    const columnName = fieldIdToName[field.id].name
    if (field.id !== selectedField.id && conversion && columnName in schema.columns) {
      const aitoValue = conversion.toAitoValue(field, record)
      if (aitoValue === null || aitoValue === undefined || aitoValue === '') {
        return acc
      } else {
        return {
          [columnName]: aitoValue === null ? null : conversion.toAitoQuery(field, aitoValue),
          ...acc,
        }
      }
    } else {
      return acc
    }
  }, {})
}

const FieldPrediction: React.FC<{
  selectedField: Field
  record: Record
  fields: Field[]
  tableColumnMap: TableColumnMap
  schema: TableSchema
  client: AitoClient
  aitoTableName: string
  setCellValue: (record: Record, field: Field, value: unknown) => Promise<unknown>
  autoFill: boolean
  canUpdate: boolean
}> = ({
  selectedField,
  fields,
  record,
  schema,
  client,
  tableColumnMap,
  aitoTableName,
  setCellValue,
  autoFill,
  canUpdate: hasPermissionToUpdate,
}) => {
  const delayedRequest = useRef<ReturnType<typeof setTimeout> | undefined>()

  const isTextField = [FieldType.RICH_TEXT, FieldType.MULTILINE_TEXT].includes(selectedField.type)
  const canUpdate = hasPermissionToUpdate && !selectedField.isComputed && !isTextField

  useEffect(() => {
    // This is run once when the element is unmounted
    return () => {
      if (delayedRequest.current !== undefined) {
        clearTimeout(delayedRequest.current)
        delayedRequest.current = undefined
      }
    }
  }, [delayedRequest])

  const hasAutomaticallySet = useRef(!_.isEmpty(record.getCellValue(selectedField.id)))
  useEffect(() => {
    if (!hasAutomaticallySet.current && autoFill && canUpdate && prediction && isSuitablePrediction(selectedField)) {
      const hit = prediction.hits[0]
      if (hit && hit.$p > 0.9) {
        const value = record.getCellValue(selectedField.id)
        if (_.isEmpty(value)) {
          const conversion = AcceptedFields[selectedField.type]
          const convertedValue = conversion ? conversion.toCellValue(hit.feature) : hit.feature
          hasAutomaticallySet.current = true
          setCellValue(record, selectedField, convertedValue)
        }
      }
    }
  })

  type PredictionError = 'quota-exceeded' | 'unknown-field' | 'empty-field' | 'error'

  const [predictionError, setPredictionError] = useState<PredictionError | null>(null)

  type Disclaimer = 'text' | 'numbers' | null
  const disclaimer: Disclaimer = predictionError
    ? null
    : isTextField
    ? 'text'
    : !isSuitablePrediction(selectedField)
    ? 'numbers'
    : null

  interface PredictionHits {
    hits: {
      $p: number
      feature: number | string | boolean | null
      $why?: Why
    }[]
  }

  const [prediction, setPrediction] = useState<PredictionHits | undefined | null>(undefined)
  useEffect(() => {
    if (delayedRequest.current !== undefined) {
      return
    }

    // Start a new request
    const delay = 50
    const fieldIdToName = tableColumnMap

    const columnName = fieldIdToName[selectedField.id]?.name
    if (!(columnName in schema.columns)) {
      setPrediction(null)
      setPredictionError('unknown-field')
      return
    }

    const hasUnmounted = () => delayedRequest.current === undefined

    delayedRequest.current = setTimeout(async () => {
      let start: Date | undefined
      try {
        await RequestLocks.acquire()

        if (hasUnmounted()) {
          return
        }

        const exclusiveness = !isMultipleSelectField(selectedField)

        const where = makeWhereClause(selectedField, fields, schema, record)
        let query = JSON.stringify({
          from: aitoTableName,
          predict: fieldIdToName[selectedField.id].name,
          exclusiveness,
          select: ['$p', 'field', 'feature', '$why'],
          limit: 5,
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
        query = query.replace(/}$/, `,"where":${whereString}}`)

        start = new Date()
        const prediction = await client.predict(query)

        if (!hasUnmounted()) {
          if (isAitoError(prediction)) {
            setPrediction(null)
            if (prediction === 'quota-exceeded') {
              setPredictionError('quota-exceeded')
            } else {
              setPredictionError('error')
            }
          } else {
            if (prediction.hits.length === 0) {
              setPredictionError('empty-field')
            }
            setPrediction(prediction)
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

  type ConfirmParameters = [unknown, unknown]
  const [confirmation, setConfirmation] = useState<ConfirmParameters | undefined>()

  const onClick = useCallback(
    (feature: unknown) => {
      const value = record.getCellValue(selectedField.id)
      const valueString = record.getCellValueAsString(selectedField.id)

      const conversion = AcceptedFields[selectedField.type]
      const convertedValue = conversion ? conversion.toCellValue(feature) : feature
      if (isMultipleSelectField(selectedField)) {
        if (isMultipleSelection(value)) {
          const predicate: (v: HasNameOrId) => boolean =
            selectedField.type === FieldType.MULTIPLE_COLLABORATORS
              ? (v) => v.id === feature
              : (v) => v.name === feature

          // Look for existing value
          if (value.find(predicate)) {
            // Remove it
            setCellValue(
              record,
              selectedField,
              value.filter((v) => !predicate(v)),
            )
          } else {
            // Remove it
            // Add it
            setCellValue(record, selectedField, [...value, ...(convertedValue as HasNameOrId[])])
          }
        } else if (value === null || (Array.isArray(value) && value.length === 0)) {
          setCellValue(record, selectedField, convertedValue)
        }
      } else if (_.isEmpty(valueString)) {
        setCellValue(record, selectedField, convertedValue)
      } else {
        setConfirmation([convertedValue, value])
      }
    },
    [record, selectedField, setCellValue, setConfirmation],
  )

  const reject = useCallback(() => {
    setConfirmation(undefined)
  }, [setConfirmation])

  const confirm = useCallback(() => {
    if (confirmation) {
      if (!isMultipleSelectField(selectedField)) {
        // We shouldn't end up here for multiple selection predictions
        setCellValue(record, selectedField, confirmation[0])
      }
      setConfirmation(undefined)
    }
  }, [record, selectedField, confirmation, setConfirmation, setCellValue])

  return (
    <Box paddingBottom={3} position="relative">
      {canUpdate && confirmation && (
        <ConfirmationDialog
          title="Replace cell"
          body={
            <>
              <Text marginBottom={3}>Do you want to replace the cell contents?</Text>
              <Label>Current value</Label>
              <CellRenderer
                field={selectedField}
                cellValue={confirmation[1]}
                renderInvalidCellValue={renderCellDefault}
              />
              <Label>Replace with</Label>
              <CellRenderer
                field={selectedField}
                cellValue={confirmation[0]}
                renderInvalidCellValue={renderCellDefault}
              />
            </>
          }
          confirmButtonText="Replace"
          onConfirm={confirm}
          onCancel={reject}
        />
      )}

      <Row isHeader={true}>
        <Cell flexGrow={1} flexShrink={1}>
          <Tooltip
            disabled={!disclaimer}
            shouldHideTooltipOnClick={false}
            placementX={Tooltip.placements.CENTER}
            placementY={Tooltip.placements.BOTTOM}
            style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
            content={() => (
              <Text margin={2} textColor="white">
                {disclaimer === 'numbers' ? (
                  <>
                    Aito is made for predicting categorical data and has limited support for continuous properties like
                    amounts and dates. Unless the values of <em>{selectedField.name}</em> are categorical in nature,
                    these predictions are not likely to be accurate.
                  </>
                ) : (
                  <>
                    Aito is not able to predict complete sentences, only words that are likely to occur in the text
                    field.
                  </>
                )}
              </Text>
            )}
          >
            <Box style={{ overflowX: 'hidden', textOverflow: 'ellipsis' }}>
              <Text display="inline" textColor="light" paddingX={3}>
                {selectedField.name}
                {disclaimer && (
                  <Icon
                    name="warning"
                    aria-label="Warning"
                    marginLeft={2}
                    style={{ verticalAlign: 'text-bottom', width: '1em', height: '1em' }}
                  />
                )}
              </Text>
              {prediction === undefined && <Loader scale={0.2} />}
            </Box>
          </Tooltip>
        </Cell>
        <Cell width="110px" flexGrow={0}>
          {prediction && !predictionError && (
            <Box display="flex" height="100%" justifyContent="left">
              <Text textColor="light">Confidence</Text>
            </Box>
          )}
        </Cell>
        <Cell width="6px" flexGrow={0}></Cell>
      </Row>
      <Box>
        {predictionError && (
          <Box marginX={3}>
            {predictionError === 'empty-field' && (
              <Text variant="paragraph">It seems there are no examples of this field in the training set.</Text>
            )}
            {predictionError === 'unknown-field' && (
              <Text variant="paragraph">This field is not part of the training set and cannot be predicted.</Text>
            )}
            {predictionError === 'quota-exceeded' && <QueryQuotaExceeded />}
            {predictionError === 'error' && <Text variant="paragraph">Unable to predict {selectedField.name}.</Text>}
          </Box>
        )}

        {!predictionError &&
          prediction &&
          prediction.hits.map(({ $p, feature, $why }, i) => {
            const conversion = AcceptedFields[selectedField.type]
            const value = conversion ? conversion.toCellValue(feature) : feature

            return (
              <Row key={i} highlight={hasFeature(record, selectedField, feature)}>
                <Cell flexGrow={1} flexShrink={1}>
                  <Box display="flex" height="100%" overflowX="hidden">
                    <CellRenderer
                      marginLeft={2}
                      flexGrow={1}
                      alignSelf="center"
                      field={selectedField}
                      cellValue={value}
                      renderInvalidCellValue={renderCellDefault}
                      cellStyle={{ margin: 0 }}
                    />
                  </Box>
                </Cell>
                <Cell width="60px" flexGrow={0}>
                  <PopupContainer>
                    <Box display="flex" height="100%" justifyContent="right">
                      <Text textColor="light" alignSelf="center">
                        {Math.round($p * 100)}%
                      </Text>
                      <Icon
                        alignSelf="center"
                        name="help"
                        aria-label="Info"
                        fillColor="light"
                        marginLeft={2}
                        style={{ verticalAlign: 'text-bottom', width: '1.0em', height: '1.0em' }}
                      />
                      <Box
                        className="popup"
                        position="absolute"
                        marginTop={3}
                        top={0}
                        left={3}
                        right={3}
                        marginRight="126px"
                        textColor="white"
                        backgroundColor="dark"
                        borderRadius="default"
                      >
                        {$why ? (
                          <ExplanationBox $p={$p} $why={$why} fields={fields} tableColumnMap={tableColumnMap} />
                        ) : (
                          <DefaultExplanationBox />
                        )}
                      </Box>
                    </Box>
                  </PopupContainer>
                </Cell>
                <Cell width="62px" flexGrow={0}>
                  <Box display="flex" height="100%" justifyContent="right">
                    {isMultipleSelectField(selectedField) ? (
                      <Button
                        marginX={2}
                        icon={hasFeature(record, selectedField, feature) ? 'minus' : 'plus'}
                        onClick={() => onClick(feature)}
                        size="small"
                        alignSelf="center"
                        disabled={!canUpdate}
                        aria-label="Toggle feature"
                        variant={hasFeature(record, selectedField, feature) ? 'danger' : 'primary'}
                      />
                    ) : (
                      <Button
                        onClick={() => onClick(feature)}
                        size="small"
                        alignSelf="center"
                        variant="default"
                        disabled={!canUpdate || hasFeature(record, selectedField, feature)}
                        marginX={2}
                      >
                        Use
                      </Button>
                    )}
                  </Box>
                </Cell>
              </Row>
            )
          })}
      </Box>
    </Box>
  )
}

export default PredictView
