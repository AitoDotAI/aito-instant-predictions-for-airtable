import { Cursor, Field, FieldType, Record, Table, TableOrViewQueryResult, ViewType } from '@airtable/blocks/models'
import {
  Box,
  Button,
  CellRenderer,
  ConfirmationDialog,
  expandRecord,
  Input,
  Label,
  Switch,
  Text,
  Tooltip,
  useBase,
  useLoadable,
  useRecordById,
  useRecordIds,
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
import { isArrayOf, isMissing, isObjectOf, isString, isTupleOf } from '../validator/validation'
import { Cell, Row } from './table'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import { DefaultExplanationBox, ExplanationBox, MatchExplanationBox } from './ExplanationBox'
import { PermissionCheckResult } from '@airtable/blocks/dist/types/src/types/mutations'
import { FlexItemSetProps, SpacingSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import useEqualValue from './useEqualValue'
import { BORDER_STYLE, InlineFieldIcon, InlineIcon } from './ui'
import WithTableSchema from './WithTableSchema'
import renderCellDefault from './renderCellDefault'
import PopupContainer from './PopupContainer'
import withRequestLock from './withRequestLock'
import useDelayedEffect from './useDelayedEffect'
import ExpandableList from './ExpandableList'

const DEFAULT_CONFIDENCE_THRESHOLD = 90

const EditThresholdDialog: React.FC<{
  threshold: number
  onConfirm: (newThreshold: number) => void
  onClose: () => void
}> = ({ threshold, onClose, onConfirm }) => {
  const [pendingThreshold, setPendingThreshold] = useState(threshold.toString())

  const onThresholdChange = (e: React.FocusEvent<HTMLInputElement>): void => {
    setPendingThreshold(e.target.value)
  }

  const asNumber = Math.floor(Number(pendingThreshold))
  const isInRange = Number.isFinite(asNumber) && asNumber >= 0 && asNumber <= 100
  const isValid = pendingThreshold !== '' && isInRange

  return (
    <ConfirmationDialog
      title="Change Confidence Threshold"
      onCancel={onClose}
      onConfirm={() => onConfirm(asNumber)}
      cancelButtonText="Close"
      confirmButtonText="Set threshold"
      isConfirmButtonDisabled={!isValid}
      body={
        <>
          <Label>Threshold percentage (0-100)</Label>
          <Input type="number" min={0} step={1} max={100} value={pendingThreshold} onChange={onThresholdChange} />
        </>
      }
    />
  )
}

const PredictionSettingsToolbar: React.FC<
  {
    disabled: boolean
    autoFill: boolean
    saveAutoFill: (value: Boolean) => void
    threshold: number
    saveThreshold: (value: number) => void
  } & FlexItemSetProps
> = ({ disabled, autoFill, saveAutoFill, threshold, saveThreshold, ...flexItem }) => {
  const [isEditThresholdModalOpen, setEditModalOpen] = useState(false)
  const showEditThresholdModal = (): void => setEditModalOpen(true)
  const hideEditThresholdModal = (): void => setEditModalOpen(false)

  return (
    <Box borderBottom={BORDER_STYLE} display="flex" backgroundColor="#f7f7f7" flexDirection="row" {...flexItem}>
      <Tooltip
        shouldHideTooltipOnClick={true}
        placementX={Tooltip.placements.CENTER}
        placementY={Tooltip.placements.BOTTOM}
        style={{ height: 'auto', width: '240px', maxWidth: '300px', whiteSpace: 'normal' }}
        content={`Use the top prediction to automatically fill an empty cell if the confidence is over ${threshold}%.`}
      >
        <Switch
          flexBasis="auto"
          flexShrink={1}
          paddingX={2}
          disabled={disabled}
          value={autoFill}
          size="small"
          onChange={saveAutoFill}
          label={<>Auto-fill cells when confidence &gt; {threshold}%</>}
          backgroundColor="transparent"
        />
      </Tooltip>
      <Button
        icon="edit"
        size="small"
        flexShrink={0}
        flexGrow={1}
        alignSelf="start"
        onClick={showEditThresholdModal}
        aria-label="Change confidence thershold"
        variant="secondary"
      />

      {isEditThresholdModalOpen && (
        <EditThresholdDialog
          threshold={threshold}
          onClose={hideEditThresholdModal}
          onConfirm={(newThreshold) => {
            saveThreshold(newThreshold)
            hideEditThresholdModal()
          }}
        />
      )}
    </Box>
  )
}

const PredictView: React.FC<
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
  const view = cursor.activeViewId ? table.getViewById(cursor.activeViewId) : null
  const metadata = useViewMetadata(view)
  const visibleFields = metadata?.visibleFields || []
  const [localConfig, setLocalConfig] = useLocalConfig()

  let savedAutoFill = false
  let savedThreshold = DEFAULT_CONFIDENCE_THRESHOLD
  try {
    savedAutoFill = Boolean(localConfig.tables[table.id] && localConfig.tables[table.id].autoFill)
    const localAutoFill = localConfig.tables[table.id] && localConfig.tables[table.id].confidenceThreshold

    if (typeof localAutoFill === 'number' && Number.isInteger(localAutoFill)) {
      savedThreshold = localAutoFill
    }
  } catch (e) {
    console.error(e)
  }

  const [autoFill, setAutoFill] = useState(savedAutoFill)
  const [threshold, setThreshold] = useState(savedThreshold)

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

  const saveThreshold = useCallback(
    (newThreshold) => {
      setThreshold(newThreshold)
      setLocalConfig({
        ...localConfig,
        tables: {
          ...localConfig.tables,
          [table.id]: {
            ...localConfig.tables[table.id],
            confidenceThreshold: newThreshold,
          },
        },
      })
    },
    [localConfig, setLocalConfig, setThreshold, table.id],
  )

  // Make sure that the selected rows and fields are up to date
  const recordsQuery = useMemo(() => table.selectRecords(), [table])
  useLoadable([cursor, metadata, recordsQuery])

  const selectedFieldCount = cursor.selectedFieldIds.length
  const selectedRecordCount = cursor.selectedRecordIds.length
  const hasSelection = selectedFieldCount > 0 && selectedRecordCount > 0

  const maxRecords = 10
  const recordIdsToPredict = _.take(cursor.selectedRecordIds, maxRecords)

  const canUpdate = table.checkPermissionsForUpdateRecords(recordIdsToPredict.map((id) => ({ id })))

  const selectedRecords = recordIdsToPredict
    .map((recordId) => recordsQuery.getRecordByIdIfExists(recordId))
    .filter((x): x is Record => Boolean(x))

  const setCellValue = async (record: Record, field: Field, value: unknown): Promise<void> => {
    if (canUpdate.hasPermission) {
      await table.updateRecordAsync(record, { [field.id]: value })
    }
  }

  const fieldsToPredict = cursor.selectedFieldIds.reduce<Field[]>((acc, fieldId) => {
    const field = table.getFieldByIdIfExists(fieldId)
    if (field) {
      return [...acc, field]
    } else {
      return acc
    }
  }, [])

  return (
    <Box display="flex" flexDirection="column" {...flexItem}>
      <PredictionSettingsToolbar
        disabled={!canUpdate.hasPermission}
        autoFill={autoFill}
        saveAutoFill={saveAutoFill}
        threshold={threshold}
        saveThreshold={saveThreshold}
        flex="none"
        flexGrow={0}
      />
      <Box display="flex" flexDirection="column" flexGrow={1} flexShrink={1}>
        <WithTableSchema client={client} hasUploaded={hasUploaded} table={table} view={view} tableConfig={tableConfig}>
          {({ schema }) => {
            if (!hasSelection) {
              return (
                <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center" flexBasis="100%">
                  <Box>
                    <Text
                      className="aito-ui"
                      variant="paragraph"
                      textColor="#bbb"
                      size="xlarge"
                      fontWeight="bold"
                      margin={0}
                      flexGrow={0}
                    >
                      Please select an empty cell
                    </Text>
                  </Box>
                </Box>
              )
            }

            if (view?.type !== ViewType.GRID) {
              return (
                <Box flexGrow={1} display="flex" alignItems="center" justifyContent="center" flexBasis="100%">
                  <Text variant="paragraph" textColor="light">
                    Predictions are only available in <em>grid views</em>.
                  </Text>
                </Box>
              )
            }

            return (
              <Box flexGrow={1} flexShrink={1} display="flex" flexDirection="column" height="0px" overflow="auto">
                {selectedRecordCount > maxRecords && (
                  <Text fontStyle="oblique" textColor="light" variant="paragraph" marginX={3} marginTop={3}>
                    Showing predictions for {maxRecords} of the {selectedRecordCount} selected records.
                  </Text>
                )}
                {recordIdsToPredict.map((recordId) => (
                  <RecordPrediction
                    key={recordId}
                    recordId={recordId}
                    selectedRecords={selectedRecords}
                    viewFields={visibleFields}
                    tableConfig={tableConfig}
                    fieldsToPredict={fieldsToPredict}
                    client={client}
                    recordsQuery={recordsQuery}
                    schema={schema}
                    setCellValue={setCellValue}
                    canUpdate={canUpdate}
                    autoFill={autoFill && canUpdate.hasPermission}
                    threshold={threshold}
                  />
                ))}
              </Box>
            )
          }}
        </WithTableSchema>
      </Box>
    </Box>
  )
}

const RecordPrediction: React.FC<{
  recordsQuery: TableOrViewQueryResult
  recordId: string
  selectedRecords: Record[]
  viewFields: Field[]
  tableConfig: TableConfig
  fieldsToPredict: Field[]
  client: AitoClient
  schema: TableSchema
  setCellValue: (record: Record, field: Field, value: unknown) => Promise<unknown>
  autoFill: boolean
  threshold: number
  canUpdate: PermissionCheckResult
}> = ({
  recordId,
  selectedRecords,
  recordsQuery,
  viewFields,
  fieldsToPredict,
  client,
  schema,
  setCellValue,
  autoFill,
  threshold,
  canUpdate,
  tableConfig,
}) => {
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
      {fieldsToPredict.map((field) => (
        <FieldPrediction
          key={field.id}
          record={record}
          fields={viewFields}
          tableConfig={tableConfig}
          client={client}
          schema={schema}
          selectedField={field}
          setCellValue={setCellValue}
          autoFill={autoFill}
          threshold={threshold}
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

const hasFeature = (record: Record, field: Field, value: any): boolean => {
  const conversion = AcceptedFields[field.type]
  if (conversion) {
    const cellValue = record.getCellValue(field)
    return conversion.hasFeature(cellValue, value, field.config)
  }
  return false
}

const addFeature = (record: Record, field: Field, value: any): unknown => {
  const cellValue = record.getCellValue(field)
  const conversion = AcceptedFields[field.type]
  if (conversion) {
    return conversion.addFeature(cellValue, value, field.config)
  }
  return cellValue
}

const removeFeature = (record: Record, field: Field, value: any): unknown => {
  const cellValue = record.getCellValue(field)
  const conversion = AcceptedFields[field.type]
  if (conversion) {
    return conversion.removeFeature(cellValue, value, field.config)
  }
  return cellValue
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
    FieldType.BARCODE,
    FieldType.EXTERNAL_SYNC_SOURCE,
    FieldType.MULTIPLE_RECORD_LINKS,
  ].includes(field.type)

const isMultipleSelectField = (field: Field): boolean => Boolean(AcceptedFields[field.type]?.isMultipleSelect)

type QueryType = 'predict' | 'match'
const queryType = (field: Field): QueryType => (field.type === FieldType.MULTIPLE_RECORD_LINKS ? 'match' : 'predict')

const makeWhereClause = (selectedField: Field, fields: Field[], schema: TableSchema, record: Record) => {
  const fieldIdToName = mapColumnNames(fields)
  const inputFields = fields.reduce<globalThis.Record<string, unknown>>((acc, field) => {
    const conversion = AcceptedFields[field.type]
    const columnName = fieldIdToName[field.id].name
    if (field.id !== selectedField.id && conversion && columnName in schema.columns) {
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
  if (queryType(selectedField) === 'match') {
    return {
      from: inputFields,
    }
  } else {
    return inputFields
  }
}

const whyIsFieldChoiceNotAllowed = (field: Field, choice: string): string | undefined => {
  const config = field.config
  if (config.type === FieldType.SINGLE_SELECT || config.type === FieldType.MULTIPLE_SELECTS) {
    const fieldExists = Boolean(config.options.choices.find(({ name }) => name === choice))
    if (fieldExists) {
      return undefined
    }
    const permission = field.checkPermissionsForUpdateOptions({
      choices: [...config.options.choices, { name: choice }],
    })
    return permission.hasPermission ? undefined : permission.reasonDisplayString
  } else if (config.type === FieldType.SINGLE_COLLABORATOR || config.type === FieldType.MULTIPLE_COLLABORATORS) {
    const collaboratorExists = Boolean(config.options.choices.find(({ id }) => id === choice))
    if (!collaboratorExists) {
      return 'This collaborator no longer has access to this base'
    }
  }
}

const fieldChoiceExists = (field: Field, name: string): Boolean => {
  const config = field.config
  if (config.type === FieldType.SINGLE_SELECT || config.type === FieldType.MULTIPLE_SELECTS) {
    return Boolean(config.options.choices.find((choice) => choice.name === name))
  }
  return true
}

const addFieldChoice = async (field: Field, name: string): Promise<void> => {
  const config = field.config
  if (config.type === FieldType.SINGLE_SELECT || config.type === FieldType.MULTIPLE_SELECTS) {
    if (!config.options.choices.find((choice) => choice.name === name)) {
      await field.updateOptionsAsync({
        choices: [...config.options.choices, { name }],
      })
    }
  }
}

interface PredictionHits {
  offset: number
  total: number
  hits: {
    $p: number
    feature?: number | string | boolean | null
    id?: string
    $why?: Why
  }[]
}

const FieldPrediction: React.FC<{
  selectedField: Field
  record: Record
  fields: Field[]
  tableConfig: TableConfig
  schema: TableSchema
  client: AitoClient
  setCellValue: (record: Record, field: Field, value: unknown) => Promise<unknown>
  autoFill: boolean
  threshold: number
  canUpdate: PermissionCheckResult
}> = ({
  selectedField,
  fields,
  record,
  schema,
  client,
  tableConfig,
  setCellValue,
  autoFill,
  threshold,
  canUpdate: hasPermissionToUpdate,
}) => {
  const tableColumnMap = tableConfig.columns
  const aitoTableName = tableConfig.aitoTableName

  const isTextField = [FieldType.RICH_TEXT, FieldType.MULTILINE_TEXT].includes(selectedField.type)
  const isExternalField = [FieldType.EXTERNAL_SYNC_SOURCE].includes(selectedField.type)
  const canUpdate = hasPermissionToUpdate.hasPermission && !selectedField.isComputed && !isTextField && !isExternalField
  const cantUpdateReason = hasPermissionToUpdate.hasPermission ? undefined : hasPermissionToUpdate.reasonDisplayString

  const hasAutomaticallySet = useRef(!_.isEmpty(record.getCellValue(selectedField.id)))
  useEffect(() => {
    if (!hasAutomaticallySet.current && autoFill && canUpdate && prediction && isSuitablePrediction(selectedField)) {
      const hit = prediction.hits[0]
      if (hit && hit.$p * 100 > threshold) {
        const value = record.getCellValue(selectedField.id)
        if (_.isEmpty(value)) {
          const conversion = AcceptedFields[selectedField.type]
          const convertedValue = conversion ? conversion.toCellValue(hit.feature, selectedField.config) : hit.feature
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

  const [prediction, setPrediction] = useState<PredictionHits | undefined | null>(undefined)
  useDelayedEffect(50, async (hasUnmounted) => {
    const fieldIdToName = tableColumnMap

    const columnName = fieldIdToName[selectedField.id]?.name
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

        const limit = 10

        const isPredictQuery = queryType(selectedField) === 'predict'
        const where = makeWhereClause(selectedField, fields, schema, record)
        let query: string
        if (isPredictQuery) {
          const exclusiveness = !isMultipleSelectField(selectedField)
          query = JSON.stringify({
            from: aitoTableName,
            predict: fieldIdToName[selectedField.id].name,
            exclusiveness,
            select: ['$p', 'field', 'feature', '$why'],
            limit,
          })
        } else {
          const linkConfig = tableConfig.links && tableConfig.links[selectedField.id]
          if (!linkConfig) {
            setPrediction(null)
            setPredictionError('unknown-field')
            return
          }
          query = JSON.stringify({
            from: linkConfig.aitoTableName,
            match: 'to',
            select: ['$p', 'id', '$why'],
            limit,
          })
        }

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

        const prediction = isPredictQuery ? await client.predict(query) : await client.match(query)

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
      })
    } catch {
      if (!hasUnmounted()) {
        setPrediction(null)
      }
    }
  })

  interface ConfirmParameters {
    confirm: 'replace' | 'add-choice'
    feature: unknown
    oldValue?: unknown
    newValue?: unknown
  }
  const [confirmation, setConfirmation] = useState<ConfirmParameters | undefined>()

  const updateField = useCallback(
    async (feature: unknown, confirm?: 'add-choice' | 'replace'): Promise<void> => {
      if (!fieldChoiceExists(selectedField, String(feature))) {
        if (confirm !== 'add-choice') {
          setConfirmation({
            confirm: 'add-choice',
            feature: feature,
          })
          return
        } else {
          try {
            await addFieldChoice(selectedField, String(feature))
          } catch (e) {
            setConfirmation(undefined)
            return
          }
        }
      }

      const value = record.getCellValue(selectedField.id)
      const valueString = record.getCellValueAsString(selectedField.id)

      const conversion = AcceptedFields[selectedField.type]
      const convertedValue = conversion ? conversion.toCellValue(feature, selectedField.config) : feature

      if (isMultipleSelectField(selectedField)) {
        if (isMultipleSelection(value)) {
          // Look for existing value to toggle
          const newCellValue = hasFeature(record, selectedField, convertedValue)
            ? removeFeature(record, selectedField, convertedValue)
            : addFeature(record, selectedField, convertedValue)

          setCellValue(record, selectedField, newCellValue)
        } else if (value === null || (Array.isArray(value) && value.length === 0)) {
          setCellValue(record, selectedField, convertedValue)
        }
      } else if (_.isEmpty(valueString) || confirm === 'replace') {
        setCellValue(record, selectedField, convertedValue)
      } else {
        setConfirmation({
          confirm: 'replace',
          feature,
          newValue: convertedValue,
          oldValue: value,
        })
        return
      }
      setConfirmation(undefined)
    },
    [record, selectedField, setCellValue, setConfirmation],
  )

  const onClick = useCallback((feature: unknown): Promise<void> => updateField(feature), [updateField])

  const reject = useCallback(() => {
    setConfirmation(undefined)
  }, [setConfirmation])

  const [isUpdatingField, setUpdatingField] = useState(false)

  const confirm = useCallback(async () => {
    if (confirmation) {
      setUpdatingField(true)
      try {
        await updateField(confirmation.feature, confirmation.confirm)
      } catch (e) {
        // It's fine, we probably want to remove the confirmation dialog
      }
      setUpdatingField(false)
    }
  }, [confirmation, updateField, setUpdatingField])

  const renderFallback = useMemo(() => renderCellDefault(selectedField), [selectedField])

  return (
    <Box paddingBottom={3} position="relative">
      {canUpdate && confirmation && (
        <ConfirmationDialog
          isCancelButtonDisabled={isUpdatingField}
          isConfirmButtonDisabled={isUpdatingField}
          title={confirmation.confirm === 'replace' ? 'Replace cell' : 'Update field'}
          body={
            <>
              {confirmation.confirm === 'add-choice' && (
                <>
                  <Text variant="paragraph">
                    <i>{selectedField.name}</i> has been changed since training data was uploaded and it no longer
                    includes {renderFallback(confirmation.feature)} among its options. Do you want to update the field
                    and make it an option again?
                  </Text>
                </>
              )}
              {confirmation.confirm === 'replace' && (
                <>
                  <Text variant="paragraph">Do you want to replace the cell contents?</Text>
                  <Label marginTop={3}>Current value</Label>
                  <CellRenderer
                    field={selectedField}
                    cellValue={confirmation.oldValue}
                    renderInvalidCellValue={renderFallback}
                  />
                  <Label>Replace with</Label>
                  <CellRenderer
                    field={selectedField}
                    cellValue={confirmation.newValue}
                    renderInvalidCellValue={renderFallback}
                  />
                </>
              )}
            </>
          }
          confirmButtonText={confirmation.confirm === 'replace' ? 'Replace' : 'Add option'}
          onConfirm={confirm}
          onCancel={reject}
        />
      )}

      <Row>
        <Cell flexGrow={1} flexShrink={1}>
          <Box style={{ overflowX: 'hidden', textOverflow: 'ellipsis' }}>
            <Text display="inline" textColor="light" paddingX={3}>
              <InlineFieldIcon fillColor="#aaa" field={selectedField} />
              {selectedField.name}
            </Text>
          </Box>
        </Cell>
        <Cell width="110px" flexGrow={0}>
          {prediction && !predictionError && (
            <Tooltip
              disabled={!disclaimer}
              shouldHideTooltipOnClick={false}
              placementX={Tooltip.placements.RIGHT}
              placementY={Tooltip.placements.BOTTOM}
              style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
              content={() => (
                <Text margin={2} textColor="white">
                  {disclaimer === 'numbers' ? (
                    <>
                      Aito is made for predicting categorical data and has limited support for continuous properties
                      like amounts and dates. Unless the values of <em>{selectedField.name}</em> are categorical in
                      nature, these predictions are not likely to be accurate.
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
              <Box display="flex" height="100%" justifyContent="left">
                <Text textColor="light">
                  Confidence
                  {disclaimer && (
                    <InlineIcon fillColor="#aaa" name="warning" aria-label="Warning" marginLeft={2} marginRight={0} />
                  )}
                </Text>
              </Box>
            </Tooltip>
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
            {predictionError === 'unknown-field' &&
              ((selectedField.type === FieldType.BUTTON && (
                <Text variant="paragraph">Button fields can not be predicted.</Text>
              )) ||
                (selectedField.type === FieldType.MULTIPLE_LOOKUP_VALUES && (
                  <Text variant="paragraph">Lookup fields can not be predicted.</Text>
                )) ||
                (selectedField.type === FieldType.MULTIPLE_ATTACHMENTS && (
                  <Text variant="paragraph">Attachment fields can not be predicted.</Text>
                )) || (
                  <Text variant="paragraph">This field is not part of the training set and cannot be predicted.</Text>
                ))}
            {predictionError === 'quota-exceeded' && <QueryQuotaExceeded />}
            {predictionError === 'error' && <Text variant="paragraph">Unable to predict {selectedField.name}.</Text>}
          </Box>
        )}

        {(!predictionError && prediction === undefined && <Spinner />) ||
          (prediction && (
            <React.Suspense fallback={<Spinner />}>
              <PredictionHitsList
                prediction={prediction}
                record={record}
                fields={fields}
                selectedField={selectedField}
                onClick={onClick}
                renderFallback={renderFallback}
                tableColumnMap={tableColumnMap}
                canUpdate={canUpdate}
                cantUpdateReason={cantUpdateReason}
              />
            </React.Suspense>
          ))}
      </Box>
    </Box>
  )
}

const isIdArray = isTupleOf([isObjectOf({ id: isString })])

const PredictionCellRenderer: React.FC<
  {
    field: Field
    cellValue: unknown
    linkedRecordsQuery: TableOrViewQueryResult | null
    renderInvalidCellValue: (value: unknown, field: Field) => React.ReactElement
  } & SpacingSetProps &
    FlexItemSetProps
> = ({ field, cellValue, linkedRecordsQuery, renderInvalidCellValue, ...other }) => {
  const isLinkedRecord = queryType(field) === 'match'
  const linkedRecordId = (isLinkedRecord && isIdArray(cellValue) && cellValue[0].id) || ''

  const linkedRecord = useRecordById((linkedRecordsQuery || null)!, linkedRecordId)

  if (isLinkedRecord) {
    if (linkedRecord) {
      return (
        <span style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => expandRecord(linkedRecord)}>
          <CellRenderer
            {...other}
            field={field}
            cellValue={[{ id: linkedRecord.id, name: linkedRecord.name }]}
            renderInvalidCellValue={renderInvalidCellValue}
            cellStyle={{ marginLeft: '4px' }}
          />
        </span>
      )
    } else {
      return (
        <CellRenderer
          {...other}
          field={field}
          cellValue={'not a list of records'}
          renderInvalidCellValue={renderInvalidCellValue}
          cellStyle={{ margin: 0 }}
        />
      )
    }
  } else {
    return (
      <CellRenderer
        {...other}
        field={field}
        cellValue={cellValue}
        renderInvalidCellValue={renderInvalidCellValue}
        cellStyle={{ margin: 0 }}
      />
    )
  }
}

export type FieldMap = globalThis.Record<string, [Table, TableOrViewQueryResult]>

const PredictionHitsList: React.FC<{
  prediction: PredictionHits
  record: Record
  selectedField: Field
  fields: Field[]
  tableColumnMap: TableColumnMap
  canUpdate: boolean
  cantUpdateReason: string | undefined
  renderFallback: (value: unknown, field: Field) => React.ReactElement
  onClick: (feature: unknown) => unknown
}> = ({
  prediction,
  record,
  selectedField,
  renderFallback,
  canUpdate,
  cantUpdateReason,
  onClick,
  fields,
  tableColumnMap,
}) => {
  const base = useBase()
  let isLink = queryType(selectedField) === 'match'

  const commonFieldList = useEqualValue(fields, (a, b) => !a.find((v, i) => v !== b[i]))
  const linkedTables = useMemo(() => {
    return commonFieldList.reduce<FieldMap>((acc, field) => {
      const config = field.config
      if (config.type === FieldType.MULTIPLE_RECORD_LINKS) {
        const tableId = config.options.linkedTableId
        const table = base.getTableByIdIfExists(tableId)
        if (table) {
          const records = table.selectRecords()
          return {
            ...acc,
            [field.id]: [table, records],
          }
        }
      }
      return acc
    }, {})
  }, [base, commonFieldList])

  const linkEntry = linkedTables[selectedField.id]
  const linkedTable = linkEntry ? linkEntry[0] : null
  const linkedRecordsQuery = linkEntry ? linkEntry[1] : null

  const linkedRecords = useRecordIds((linkedRecordsQuery || null)!) || []
  useWatchable(linkedTable, 'fields')

  const uniformProbability = 1 / prediction.total
  const badIndex = prediction.hits.findIndex((value) => value.$p < uniformProbability)
  const headSize = Math.min(5, badIndex < 0 ? 5 : badIndex)

  return (
    <ExpandableList list={prediction.hits} headSize={headSize}>
      {({ list }) =>
        list.map(({ $p, feature, id, $why }, i) => {
          const featureOrId = feature || id
          const conversion = AcceptedFields[selectedField.type]
          let value = conversion ? conversion.toCellValue(featureOrId, selectedField.config) : featureOrId

          const hitCount = list.length
          const hitsBoxHeight = 16 + 49.5 * hitCount
          const beforeFraction = (16 + 49.5 * i) / hitsBoxHeight
          const afterFraction = (hitsBoxHeight - (i + 1) * 49.5) / hitsBoxHeight
          const disallowedReason = whyIsFieldChoiceNotAllowed(selectedField, String(featureOrId))
          const fieldHasFeature = hasFeature(record, selectedField, value)

          const canRemove = true

          const recordWasRemoved = isLink && id && !linkedRecords.includes(id)
          const canUse = !recordWasRemoved
          const isRemoveAction = fieldHasFeature && canRemove

          return (
            <React.Fragment key={i}>
              {i === badIndex && <Box marginX={4} borderBottom="thin dashed lightgray" />}
              <Row highlight={fieldHasFeature}>
                <Cell flexGrow={1} flexShrink={1}>
                  <Box display="flex" height="100%" overflow="hidden">
                    <PredictionCellRenderer
                      marginLeft={2}
                      flexGrow={1}
                      alignSelf="center"
                      field={selectedField}
                      linkedRecordsQuery={linkedRecordsQuery}
                      cellValue={value}
                      renderInvalidCellValue={renderFallback}
                    />
                  </Box>
                </Cell>
                <Cell width="60px" flexGrow={0}>
                  <PopupContainer>
                    <Box display="flex" height="100%" justifyContent="right" marginBottom={1}>
                      <Text textColor="light" alignSelf="center">
                        {Math.round($p * 100)}%
                      </Text>
                      <InlineIcon
                        alignSelf="center"
                        name="help"
                        aria-label="Info"
                        fillColor="#aaa"
                        marginLeft={2}
                        marginRight={0}
                      />
                      <Box
                        className="popup"
                        position="absolute"
                        marginTop={3}
                        top={0}
                        marginLeft={3}
                        minWidth="200px"
                        right={0}
                        marginRight="125px"
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
                          >
                            {$why ? (
                              linkedTable ? (
                                <MatchExplanationBox
                                  $p={$p}
                                  $why={$why}
                                  contextFields={fields}
                                  hitFields={linkedTable.fields}
                                />
                              ) : (
                                <ExplanationBox
                                  $p={$p}
                                  $why={$why}
                                  fields={fields}
                                  tableColumnMap={tableColumnMap}
                                  linkedTables={linkedTables}
                                />
                              )
                            ) : (
                              <DefaultExplanationBox />
                            )}
                          </Box>
                          <Box flexShrink={afterFraction} flexGrow={afterFraction}></Box>
                        </Box>
                      </Box>
                    </Box>
                  </PopupContainer>
                </Cell>
                <Cell width="62px" flexGrow={0}>
                  <Box display="flex" height="100%" justifyContent="right">
                    <Tooltip
                      disabled={!disallowedReason && canUpdate}
                      content={cantUpdateReason || disallowedReason || ''}
                    >
                      {isMultipleSelectField(selectedField) ? (
                        <Button
                          marginX={2}
                          icon={isRemoveAction ? 'minus' : 'plus'}
                          onClick={() => onClick(featureOrId)}
                          size="small"
                          alignSelf="center"
                          disabled={
                            !canUse || !canUpdate || Boolean(disallowedReason) || (fieldHasFeature && !canRemove)
                          }
                          aria-label="Toggle feature"
                          variant={isRemoveAction ? 'danger' : 'primary'}
                        />
                      ) : (
                        <Button
                          onClick={() => onClick(featureOrId)}
                          size="small"
                          alignSelf="center"
                          variant="default"
                          disabled={!canUpdate || fieldHasFeature || Boolean(disallowedReason)}
                          marginX={2}
                        >
                          Use
                        </Button>
                      )}
                    </Tooltip>
                  </Box>
                </Cell>
              </Row>
            </React.Fragment>
          )
        })
      }
    </ExpandableList>
  )
}

export default PredictView
