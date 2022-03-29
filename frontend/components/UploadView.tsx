import { Field, FieldType, Table, View, ViewType } from '@airtable/blocks/models'
import {
  Box,
  Button,
  CollaboratorToken,
  FieldIcon,
  FormField,
  Icon,
  Loader,
  Heading,
  Text,
  useBase,
  useRecordIds,
  useSession,
  useViewMetadata,
  ViewPicker,
  Link,
} from '@airtable/blocks/ui'
import React, { useCallback, useEffect, useState } from 'react'
import { isAcceptedField, isIgnoredField } from '../AcceptedFields'
import AitoClient from '../AitoClient'
import { UploadResult } from '../functions/uploadView'
import { TableColumnMap, TableConfig } from '../schema/config'
import Footer from './Footer'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import StatusMessage from './StatusMessage'
import { Tab } from './Tab'
import { Cell, Row } from './table'

const FIELD_INCLUDE_CELL_WIDTH_PERCENTAGE = '24px'
const FIELD_CELL_WIDTH_PERCENTAGE = '45%'
const FIELD_DESCRIPTION_CELL_WIDTH_PERCENTAGE = '45%'

const TABLE_NAME_PATTERN = /^[a-zA-Z0-9_-]*$/
const MAX_TABLE_NAME_LENGTH = 60

const UploadStatusMessage: React.FC = ({ children }) => (
  <Box backgroundColor="rgb(45,127,249)" borderColor="#404040" borderWidth="thick" width="100%" padding={3}>
    <Text variant="paragraph" size="large" textColor="white" margin={0} padding={0}>
      {children}
    </Text>
  </Box>
)

const UploadView: React.FC<{
  table: Table
  tableConfig: TableConfig
  onUpload: (view: View, aitoTableName: string) => Promise<UploadResult | undefined>
  setTableConfig: (table: Table, tableConfig: TableConfig) => Promise<unknown>
  setTab: (tab: Tab) => unknown
  canUpdateSettings: boolean
  client: AitoClient
}> = ({ table, onUpload, tableConfig, setTableConfig, setTab, canUpdateSettings, client }) => {
  // We read the fields from viewMetadata instead of using table.fields because fields are only
  // ordered in the context of a specific view.
  // Also, this allows us to only show the fields visible within the selected view.
  const base = useBase()

  type UploadState = 'idle' | 'uploading' | 'done' | 'error'
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [pendingTableConfig, setPendingConfig] = useState(tableConfig)
  const session = useSession()

  const airtableViewId = pendingTableConfig?.airtableViewId
  const selectedView = airtableViewId ? table.getViewByIdIfExists(airtableViewId) : null
  const [fieldsAreAcceptable, setFieldsAreAcceptable] = useState<boolean | undefined>(undefined)
  const [fieldsAreIgnored, setFieldsAreIgnored] = useState<boolean | undefined>(undefined)
  const [numberOfRows, setNumberOfRows] = useState<number | undefined>(undefined)
  const [uploadedRows, setUploadedRows] = useState(0)
  const [isQuotaExceeded, setQuotaExceeded] = useState(false)

  const doUpload = useCallback(async () => {
    try {
      const user = session.currentUser
      const { aitoTableName, airtableViewId } = pendingTableConfig
      const view = airtableViewId && table.getViewByIdIfExists(airtableViewId)
      if (view && user) {
        setUploadState('uploading')
        setQuotaExceeded(false)
        const result = await onUpload(view, aitoTableName)
        if (!result) {
          setUploadState('error')
        } else if (result.type === 'success') {
          const columns: TableColumnMap = result.columns
          await setTableConfig(table, {
            ...pendingTableConfig,
            lastRowCount: result.rowCount,
            lastUpdated: new Date().toISOString(),
            lastUpdatedBy: {
              id: user.id,
              name: user.name,
            },
            columns,
          })
          setUploadedRows(result.rowCount)
          setUploadState('done')
        } else {
          if (result.error === 'quota-exceeded') {
            setQuotaExceeded(true)
          }
          setUploadState('error')
        }
      }
    } catch (e) {
      console.error(e)
      setUploadState('error')
    }
  }, [table, pendingTableConfig, onUpload, setUploadState, setTableConfig, session])

  const isUploading = uploadState === 'uploading'

  const tableName = pendingTableConfig.aitoTableName.trim()
  const isNameEmpty = tableName.length == 0
  const isNameValid = TABLE_NAME_PATTERN.test(tableName)
  const isNameTooLong = tableName.length > MAX_TABLE_NAME_LENGTH
  const canSaveName = !isNameEmpty && !isNameTooLong && isNameValid
  let uploadValidationStatus: string = ''
  if (isNameEmpty) uploadValidationStatus = 'empty'
  if (!isNameValid) uploadValidationStatus = 'invalid'
  if (isNameTooLong) uploadValidationStatus = 'too-long'
  if (fieldsAreIgnored) uploadValidationStatus = 'ignored-fields'
  if (fieldsAreAcceptable === false) uploadValidationStatus = 'unsupported'
  if (isQuotaExceeded) uploadValidationStatus = 'quota-exceeded'

  useEffect(() => {
    if (uploadState === 'error') {
      // Transition from 'error' to 'idle' after a short while unless
      // we transition to something else in-between
      const timeout = setTimeout(() => setUploadState('idle'), 5000)
      return () => clearTimeout(timeout)
    }
  }, [uploadState, setUploadState])

  const changeTableConfig = useCallback(
    (newConfig: TableConfig) => {
      setPendingConfig(newConfig)
    },
    [setPendingConfig],
  )

  const goToPredict = useCallback(() => setTab('predict'), [setTab])

  const lastUploader =
    base.activeCollaborators.find((c) => c.id === tableConfig.lastUpdatedBy?.id) || tableConfig.lastUpdatedBy

  return (
    <>
      <Box
        style={{
          opacity: uploadState === 'done' ? 0 : 1,
          visibility: uploadState === 'done' ? 'hidden' : 'visible',
          height: uploadState === 'done' ? 0 : 'auto',
          overflow: 'hidden',
          transition: 'opacity 0.4s 0s, visibility 0s 0.5s, height 0s 0.5s',
        }}
      >
        <Box paddingX={3} paddingTop={2}>
          <Heading marginBottom={1}>Upload training data</Heading>
          <Text variant="paragraph" textColor="light">
            Training data is required for making predictions. Select or create a <em>grid view</em> to use for training.
            The records and fields that are visible are uploaded to your Aito cloud instance. More tips at Aito.ai{' '}
            <a target="_blank" href="https://aito.document360.io/docs/airtable" rel="noopener noreferrer">
              blog
            </a>
            .
          </Text>
        </Box>
        <Box margin={3}>
          <FormField label="Training data view" marginBottom={1}>
            <ViewPicker
              allowedTypes={[ViewType.GRID]}
              table={table}
              view={table.views.find((v) => v.id === pendingTableConfig.airtableViewId)}
              disabled={!canUpdateSettings}
              onChange={(e) => e && changeTableConfig({ ...pendingTableConfig, airtableViewId: e.id })}
              placeholder="Select Grid View..."
            />
          </FormField>
          {selectedView && (
            <React.Suspense
              fallback={
                <Box display="flex" flexDirection="column">
                  <Loader scale={0.3} alignSelf="center" />
                </Box>
              }
            >
              <HeaderRow />
              <FieldTable
                view={selectedView}
                setFieldsAreAcceptable={setFieldsAreAcceptable}
                setFieldsAreIgnored={setFieldsAreIgnored}
                setNumberOfRows={setNumberOfRows}
              />
            </React.Suspense>
          )}
        </Box>
        <Box marginX={3} marginTop={3} marginBottom={2}>
          <Text variant="paragraph" textColor="light">
            The {typeof numberOfRows === 'undefined' ? null : numberOfRows} records visible in the view{' '}
            <em>{selectedView?.name || 'the view'}</em> will be uploaded to your Aito instance{' '}
            <strong>{client.name}</strong> to a table called <strong>{pendingTableConfig.aitoTableName}</strong>. If a
            table with that name already exists then it will be replaced.
          </Text>

          {lastUploader && (
            <Box marginBottom={3}>
              <Box as="span" display="inline-block" style={{ verticalAlign: 'middle' }}>
                <CollaboratorToken collaborator={lastUploader || {}} flexGrow={0} />
              </Box>{' '}
              <Text as="span" textColor="light">
                uploaded {tableConfig.lastRowCount} records at {new Date(tableConfig.lastUpdated || 0).toLocaleString()}
              </Text>
            </Box>
          )}

          <Box display="flex" justifyContent="space-between">
            <Button
              disabled={!fieldsAreAcceptable || isUploading || !canSaveName}
              onClick={doUpload}
              variant="primary"
              icon="upload"
            >
              Upload{numberOfRows === undefined ? null : ` ${numberOfRows} records`}
            </Button>

            <Button disabled={isUploading} onClick={goToPredict} variant="secondary">
              Cancel
            </Button>
          </Box>

          <StatusMessage message={uploadValidationStatus} marginTop={[2]}>
            <Text data-message="empty" variant="paragraph" textColor="red" size="small">
              The name cannot be empty.
            </Text>
            <Text data-message="too-long" variant="paragraph" textColor="red" size="small">
              The name is too long. It must be 60 characters or shorter.
            </Text>
            <Text data-message="invalid" variant="paragraph" textColor="red" size="small">
              The name contains invalid characters. It may only contain digits, letters, underscores, and hyphens.
            </Text>
            <Text data-message="ignored-fields" variant="paragraph" textColor="light" size="small">
              NOTE: Button fields and lookup fields will not be added to your Aito table&apos;s schema.
            </Text>
            <Text data-message="unsupported" variant="paragraph" textColor="red" size="small">
              <strong>{selectedView?.name || ''}</strong> contains fields that are unsupported by Aito. Please hide them
              from the view before uploading. TIP: create a new view that only contains the fields you want to copy to
              Aito as training data - and hide the rest.
            </Text>
            <QueryQuotaExceeded data-message="quota-exceeded" />
          </StatusMessage>
          <Box marginY={3}>
            <Footer />
          </Box>
        </Box>
      </Box>

      <Box position="fixed" top={0} left={0} right={0} width="100%">
        <StatusMessage message={uploadState} autoHide>
          <UploadStatusMessage data-message="uploading">
            <Loader fillColor="white" scale={0.2} /> Uploading...
          </UploadStatusMessage>
          <UploadStatusMessage data-message="error">Failed to upload content!</UploadStatusMessage>
        </StatusMessage>
      </Box>

      <Box
        position="fixed"
        top={0}
        left={0}
        right={0}
        style={{
          opacity: uploadState === 'done' ? 1 : 0,
          transform: `translateY(${uploadState === 'done' ? 0 : '-2em'})`,
          visibility: uploadState === 'done' ? 'visible' : 'hidden',
          transitionProperty: 'opacity transform',
          transitionDuration: '0.5s',
        }}
        padding={3}
      >
        <Heading>Done!</Heading>
        <Text variant="paragraph">
          There are {uploadedRows} rows in a table called {pendingTableConfig.aitoTableName} in your Aito.ai instance.
        </Text>

        <Text variant="paragraph">
          <strong>Note:</strong> Training data is not automatically synchronized to your Aito.ai instance. If your
          training data changes and you want your predictions to be informed by the updates then you can re-upload the
          new training.
        </Text>

        <Box display="flex" flexDirection="row" flexWrap="wrap">
          <Button onClick={goToPredict} marginRight={2}>
            Click here to start predicting
          </Button>
          <Text style={{ whiteSpace: 'nowrap' }} lineHeight="32px">
            <Link href="https://console.aito.ai/" target="_blank">
              or evaluate the accuracy in Aito console
            </Link>
          </Text>
        </Box>
      </Box>
    </>
  )
}

const FieldTable: React.FC<{
  view: View
  setFieldsAreAcceptable: (value: boolean | undefined) => void
  setFieldsAreIgnored: (value: boolean | undefined) => void
  setNumberOfRows: (value: number | undefined) => void
}> = ({ view, setNumberOfRows, setFieldsAreAcceptable, setFieldsAreIgnored }) => {
  const viewMetadata = useViewMetadata(view)
  const visibleFields = viewMetadata.visibleFields

  const visibleRecords = useRecordIds(view) || []

  const count = visibleRecords.length

  useEffect(() => {
    setNumberOfRows(count)
    return () => setNumberOfRows(undefined)
  }, [setNumberOfRows, count])

  const fieldsAreAcceptable = Boolean(viewMetadata && viewMetadata.visibleFields.every(isAcceptedField))
  useEffect(() => {
    setFieldsAreAcceptable(fieldsAreAcceptable)
    return () => setFieldsAreAcceptable(undefined)
  }, [setFieldsAreAcceptable, fieldsAreAcceptable])

  const fieldsAreIgnored = Boolean(viewMetadata && viewMetadata.visibleFields.some(isIgnoredField))
  useEffect(() => {
    setFieldsAreIgnored(fieldsAreIgnored)
    return () => setFieldsAreIgnored(undefined)
  }, [setFieldsAreIgnored, fieldsAreIgnored])

  return (
    <>
      {visibleFields.map((field) => (
        <FieldRow key={field.id} field={field} />
      ))}
    </>
  )
}

// Presentational header row helper component.
const HeaderRow: React.FC = () => {
  return (
    <Row isHeader={true}>
      <Cell width={FIELD_INCLUDE_CELL_WIDTH_PERCENTAGE} flexGrow={0} flexShrink={0}></Cell>
      <Cell width={FIELD_CELL_WIDTH_PERCENTAGE}>
        <Text textColor="light">Field name</Text>
      </Cell>
      <Cell width={FIELD_DESCRIPTION_CELL_WIDTH_PERCENTAGE}>
        <Text textColor="light">Field type</Text>
      </Cell>
    </Row>
  )
}

const FieldRow: React.FC<{
  field: Field
}> = ({ field }) => {
  const fieldType = getHumanReadableFieldType(field)
  const isAccepted = isAcceptedField(field)
  const isIgnored = isIgnoredField(field)

  return (
    <Row>
      <Cell width={FIELD_INCLUDE_CELL_WIDTH_PERCENTAGE} flexGrow={0} flexShrink={0}>
        <Box display="flex" justifyContent="center">
          {isIgnored ? (
            <Icon name="check" size={16} fillColor="#757575" />
          ) : isAccepted ? (
            <Icon name="check" size={16} fillColor="green" />
          ) : (
            <Icon name="warning" size={16} fillColor="red" />
          )}
        </Box>
      </Cell>
      <Cell width={FIELD_CELL_WIDTH_PERCENTAGE}>
        <Text
          width="100%"
          fontWeight="strong"
          textColor={isIgnored ? 'light' : isAccepted ? undefined : 'red'}
          overflowX="hidden"
          style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
          paddingRight={1}
        >
          {field.name}
        </Text>
      </Cell>
      <Cell width={FIELD_DESCRIPTION_CELL_WIDTH_PERCENTAGE}>
        <Text textColor="light" display="flex" alignItems="center" marginTop={1}>
          <FieldIcon field={field} marginRight={1} /> {fieldType}
        </Text>
      </Cell>
    </Row>
  )
}

function getHumanReadableFieldType(field: Field): string {
  // Format the field types to more closely match those in Airtable's UI
  switch (field.type) {
    case FieldType.DATE_TIME:
      return 'Date with time'
    case FieldType.MULTILINE_TEXT:
      return 'Long text'
    case FieldType.MULTIPLE_ATTACHMENTS:
      return 'Attachments'
    case FieldType.MULTIPLE_RECORD_LINKS:
      return 'Linked records'
    case FieldType.MULTIPLE_SELECTS:
      return 'Multiple select'
    case FieldType.URL:
      return 'URL'
    default:
      // For everything else, just convert it from camel case
      // https://stackoverflow.com/questions/4149276/how-to-convert-camelcase-to-camel-case
      return field.type
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .replace(/^./, function (str) {
          return str.toUpperCase()
        })
  }
}

export default UploadView
