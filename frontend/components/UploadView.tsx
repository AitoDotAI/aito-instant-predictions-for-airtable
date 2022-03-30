import { Field, Table, View, ViewType } from '@airtable/blocks/models'
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
  Label,
  Tooltip,
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
              <FieldTable
                view={selectedView}
                aitoTableName={pendingTableConfig.aitoTableName}
                setFieldsAreAcceptable={setFieldsAreAcceptable}
                setNumberOfRows={setNumberOfRows}
              />
            </React.Suspense>
          )}
        </Box>
        <Box marginX={3} marginTop={4} marginBottom={2}>
          <Text variant="paragraph" textColor="light">
            Press the button below to upload the table records to your Aito instance <strong>{client.name}</strong>. Any
            existing table named <strong>{pendingTableConfig.aitoTableName}</strong> will be replaced.
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

const InlineFieldList: React.FC<{
  fields: Field[]
}> = ({ fields }) => (
  <Text
    variant="paragraph"
    style={{
      lineHeight: '24px',
      paddingTop: '-4px',
      paddingBottom: '-4px',
      overflowX: 'hidden',
      textOverflow: 'break-word',
    }}
  >
    {fields.map((field, i) => (
      <>
        <span style={{ whiteSpace: 'nowrap', overflowWrap: 'break-word' }}>
          <FieldIcon marginRight={1} style={{ verticalAlign: 'text-bottom' }} fillColor="gray" field={field} />
          &nbsp;{field.name}
        </span>
        {i + 1 < fields.length && <span style={{ letterSpacing: '24px' }}> </span>}
      </>
    ))}
  </Text>
)

const FieldTable: React.FC<{
  view: View
  aitoTableName: string
  setFieldsAreAcceptable: (value: boolean | undefined) => void
  setNumberOfRows: (value: number | undefined) => void
}> = ({ view, aitoTableName, setNumberOfRows, setFieldsAreAcceptable }) => {
  const viewMetadata = useViewMetadata(view)
  const visibleFields = viewMetadata.visibleFields

  const visibleRecords = useRecordIds(view) || []

  const count = visibleRecords.length

  useEffect(() => {
    setNumberOfRows(count)
    return () => setNumberOfRows(undefined)
  }, [setNumberOfRows, count])

  const fieldsAreAcceptable = visibleFields.every(isAcceptedField)
  useEffect(() => {
    setFieldsAreAcceptable(fieldsAreAcceptable)
    return () => setFieldsAreAcceptable(undefined)
  }, [setFieldsAreAcceptable, fieldsAreAcceptable])

  const acceptedFields = viewMetadata ? viewMetadata.visibleFields.filter(isAcceptedField) : []
  const includedFields = acceptedFields.filter((x) => !isIgnoredField(x))
  const excludedFields = acceptedFields.filter(isIgnoredField)

  return (
    <Box marginTop={2}>
      <Label>Aito Table Name</Label>
      <Text variant="paragraph">{aitoTableName}</Text>
      <Label>Content</Label>
      <Text variant="paragraph">{count} records</Text>
      <Label>Fields</Label>
      <InlineFieldList fields={includedFields} />
      {excludedFields.length > 0 && (
        <>
          <Label>
            Excluded Fields{' '}
            <Tooltip
              style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
              content="Button fields, attachment fields and lookup fields are not supported and will not be uploaded to your Aito table. These fields cannot be predicted."
            >
              <Icon name="help" style={{ verticalAlign: 'bottom' }} />
            </Tooltip>
          </Label>
          <InlineFieldList fields={excludedFields} />
        </>
      )}
    </Box>
  )
}

export default UploadView
