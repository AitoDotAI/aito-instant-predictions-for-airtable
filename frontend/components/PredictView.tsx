import {
  Cursor,
  Field,
  FieldConfig,
  FieldType,
  Record,
  Table,
  TableOrViewQueryResult,
  ViewType,
} from '@airtable/blocks/models'
import {
  Box,
  Button,
  CellRenderer,
  ConfirmationDialog,
  expandRecord,
  FieldIcon,
  Icon,
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
import Semaphore from 'semaphore-async-await'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import { Why } from '../explanations'
import { DefaultExplanationBox, ExplanationBox, MatchExplanationBox } from './ExplanationBox'
import styled from 'styled-components'
import { PermissionCheckResult } from '@airtable/blocks/dist/types/src/types/mutations'
import { FlexItemSetProps, SpacingSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import Spinner from './Spinner'
import useEqualValue from './useEqualValue'

const DEFAULT_CONFIDENCE_THRESHOLD = 90

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

const PredictionSettingsToolbar: React.FC<{
  disabled: boolean
  autoFill: boolean
  saveAutoFill: (value: Boolean) => void
  threshold: number
  saveThreshold: (value: number) => void
}> = ({ disabled, autoFill, saveAutoFill, threshold, saveThreshold }) => {
  const [isEditThresholdModalOpen, setEditModalOpen] = useState(false)
  const showEditThresholdModal = (): void => setEditModalOpen(true)
  const hideEditThresholdModal = (): void => setEditModalOpen(false)

  return (
    <Box borderBottom="thick" display="flex" flexDirection="row">
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
          paddingX={3}
          disabled={disabled}
          value={autoFill}
          onChange={saveAutoFill}
          label={<>Auto-fill cells when confidence &gt; {threshold}%</>}
          backgroundColor="transparent"
        />
      </Tooltip>
      <Button
        icon="edit"
        flexShrink={0}
        flexGrow={1}
        alignSelf="start"
        onClick={showEditThresholdModal}
        aria-label="Change confidence thershold"
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

  const aitoTableName = tableConfig.aitoTableName
  const tableColumnMap = tableConfig.columns

  const schema = useAitoSchema(aitoTableName, client)

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
      return <Spinner />
    }
  }

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
      <Box padding={3} flexGrow={1} flexBasis="100%" display="flex" alignItems="center" justifyContent="center">
        <Box>
          <Text variant="paragraph" textColor="#bbb" size="xlarge" fontWeight="bold" margin={0} flexGrow={0}>
            Please select an empty cell
          </Text>
        </Box>
      </Box>
    )
  }

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
          The fields have changed since training data was last uploaded to Aito. Please retrain the model.
        </Text>
      </Box>
    )
  }

  return (
    <Box>
      <PredictionSettingsToolbar
        disabled={!canUpdate.hasPermission}
        autoFill={autoFill}
        saveAutoFill={saveAutoFill}
        threshold={threshold}
        saveThreshold={saveThreshold}
      />
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
        borderBottom="thick"
        style={{ textOverflow: 'ellipsis', overflowX: 'hidden' }}
      >
        <span style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={openRecord}>
          <Icon name="expand" marginRight={1} style={{ verticalAlign: 'text-bottom' }} />
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

const renderCellDefault = (field: Field) => {
  const RenderCell = (cellValue: unknown): React.ReactElement => {
    if (field.type === FieldType.SINGLE_COLLABORATOR || field.type === FieldType.MULTIPLE_COLLABORATORS) {
      return (
        <Box marginLeft={2}>
          <i>Unknown collaborator</i>
        </Box>
      )
    }
    if (field.type === FieldType.MULTIPLE_RECORD_LINKS) {
      return (
        <Box marginLeft={2}>
          <i>Unknown record</i>
        </Box>
      )
    }
    let value: string = String(cellValue)
    try {
      const af = AcceptedFields[field.type]
      if (af) {
        value = af.cellValueToText(cellValue, field.config)
      }
    } catch {
      // Ignore
    }
    return <i>{value}</i>
  }
  return RenderCell
}

const makeWhereClause = (
  selectedField: Field,
  fields: Field[],
  aitoTableName: string,
  schema: TableSchema,
  record: Record,
) => {
  const fieldIdToName = mapColumnNames(fields)
  const inputFields = fields.reduce<globalThis.Record<string, unknown>>((acc, field) => {
    const conversion = AcceptedFields[field.type]
    const columnName = fieldIdToName[field.id].name
    if (field.id !== selectedField.id && conversion && columnName in schema.columns) {
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
  if (queryType(selectedField) === 'match') {
    return {
      [aitoTableName]: inputFields,
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
  const delayedRequest = useRef<ReturnType<typeof setTimeout> | undefined>()

  const tableColumnMap = tableConfig.columns
  const aitoTableName = tableConfig.aitoTableName

  const isTextField = [FieldType.RICH_TEXT, FieldType.MULTILINE_TEXT].includes(selectedField.type)
  const canUpdate = hasPermissionToUpdate.hasPermission && !selectedField.isComputed && !isTextField
  const cantUpdateReason = hasPermissionToUpdate.hasPermission ? undefined : hasPermissionToUpdate.reasonDisplayString

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

        const limit = 5

        const isPredictQuery = queryType(selectedField) === 'predict'
        const where = makeWhereClause(selectedField, fields, aitoTableName, schema, record)
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
          const targetColumn = Object.keys(linkConfig.columns).find((key) => key !== aitoTableName)
          if (!targetColumn) {
            setPrediction(null)
            setPredictionError('unknown-field')
            return
          }

          query = JSON.stringify({
            from: linkConfig.aitoTableName,
            match: targetColumn,
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

        start = new Date()
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
              <FieldIcon
                fillColor="#aaa"
                field={selectedField}
                style={{ verticalAlign: 'text-bottom' }}
                marginRight={1}
              />
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
                    <Icon
                      fillColor="#aaa"
                      name="warning"
                      aria-label="Warning"
                      marginLeft={2}
                      style={{ verticalAlign: 'text-bottom' }}
                    />
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

  return (
    <>
      {prediction.hits.map(({ $p, feature, id, $why }, i) => {
        const featureOrId = feature || id
        const conversion = AcceptedFields[selectedField.type]
        let value = conversion ? conversion.toCellValue(featureOrId, selectedField.config) : featureOrId

        const hitCount = prediction.hits.length
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
          <Row key={i} highlight={fieldHasFeature}>
            <Cell flexGrow={1} flexShrink={1}>
              <Box display="flex" height="100%" overflowX="hidden">
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
                <Box display="flex" height="100%" justifyContent="right">
                  <Text textColor="light" alignSelf="center">
                    {Math.round($p * 100)}%
                  </Text>
                  <Icon
                    alignSelf="center"
                    name="help"
                    aria-label="Info"
                    fillColor="gray"
                    marginLeft={2}
                    style={{ verticalAlign: 'text-bottom', width: '1.0em', height: '1.0em' }}
                  />
                  <Box
                    className="popup"
                    position="absolute"
                    marginTop={3}
                    top={0}
                    marginLeft={3}
                    minWidth="200px"
                    right={3}
                    marginRight="126px"
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
                <Tooltip disabled={!disallowedReason && canUpdate} content={cantUpdateReason || disallowedReason || ''}>
                  {isMultipleSelectField(selectedField) ? (
                    <Button
                      marginX={2}
                      icon={isRemoveAction ? 'minus' : 'plus'}
                      onClick={() => onClick(featureOrId)}
                      size="small"
                      alignSelf="center"
                      disabled={!canUse || !canUpdate || Boolean(disallowedReason) || (fieldHasFeature && !canRemove)}
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
        )
      })}
    </>
  )
}

export default PredictView
