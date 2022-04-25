import { FlexItemSetProps, MarginProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Field, FieldType, Table, View, ViewType } from '@airtable/blocks/models'
import {
  Box,
  Button,
  FieldIcon,
  FormField,
  Heading,
  Text,
  useRecordIds,
  useViewMetadata,
  ViewPicker,
  Label,
  Tooltip,
  useBase,
  useRecords,
} from '@airtable/blocks/ui'
import _ from 'lodash'
import React, { useEffect, useState } from 'react'
import { isAcceptedField, isDataField, isIgnoredField } from '../AcceptedFields'
import AitoClient from '../AitoClient'
import { describeTasks, UploadTask } from '../functions/uploadView'
import { TableConfig } from '../schema/config'
import Footer from './Footer'
import Spinner from './Spinner'
import { InlineFieldIcon, InlineIcon, InlineLink } from './ui'
import useEqualValue from './useEqualValue'

interface TableViewMapping {
  fieldId: string
  tableId: string
  viewId: string
  aitoTableName: string
  recordCount?: number
}

interface LinkedTableViewMapping {
  mainViewId: string | null
  mainTableName: string
  recordCount?: number
  linkCount?: number
  linkFields: string[]
  linkedTableData: TableViewMapping[]
}

export interface UploadJob {
  tableId: string
  viewId: string
  aitoTableName: string
  oldAitoTableName: string
  tasks: UploadTask[]
}

const UploadConfigView: React.FC<
  {
    table: Table
    tableConfig: TableConfig
    onUpload: (job: UploadJob) => unknown
    canUpdateSettings: boolean
    client: AitoClient
  } & FlexItemSetProps
> = ({ table, tableConfig, canUpdateSettings, client, onUpload, ...flexItem }) => {
  const base = useBase()

  const oldAitoTableName = tableConfig.aitoTableName

  const [linkedTableViewMapping, setLinkedTableViewMapping] = useState<LinkedTableViewMapping>(() => ({
    mainViewId: tableConfig.airtableViewId || null,
    mainTableName: `airtable_${table.id}`,
    linkFields: tableConfig.links ? Object.keys(tableConfig) : [],
    linkedTableData: tableConfig.links
      ? Object.entries(tableConfig.links).reduce<TableViewMapping[]>((acc, [fieldId, link]) => {
          const view = (tableConfig.views || []).find((cfg) => Object.keys(link.columns).includes(cfg.aitoTableName))
          if (view) {
            return [
              ...acc,
              {
                fieldId,
                aitoTableName: view.aitoTableName,
                tableId: view.airtableTableId,
                viewId: view.airtableViewId,
              },
            ]
          } else {
            return acc
          }
        }, [])
      : [],
  }))

  const { mainTableName, mainViewId, linkFields, linkedTableData } = linkedTableViewMapping
  const selectedView = (mainViewId && table.getViewByIdIfExists(mainViewId)) || table.getFirstViewOfType(ViewType.GRID)

  const totalRecords =
    (linkedTableViewMapping.recordCount || 0) +
    linkFields.reduce((acc, fieldId) => {
      return acc + (linkedTableData.find((mapping) => mapping.fieldId === fieldId)?.recordCount || 0)
    }, 0)
  const totalLinks = linkedTableViewMapping.linkCount || 0

  const [isUploading, setIsUploading] = useState(false)

  const doUpload = async () => {
    if (!mainViewId || isUploading) {
      return
    }
    setIsUploading(true)

    try {
      const tasks = await describeTasks(
        base,
        table.id,
        mainViewId,
        mainTableName,
        linkFields.map((fieldId) => {
          const mapping = linkedTableData.find((mapping) => mapping.fieldId === fieldId)!
          return {
            aitoTable: mapping.aitoTableName,
            linkFieldId: fieldId,
            tableId: mapping.tableId,
            viewId: mapping.viewId,
          }
        }),
      )
      onUpload({
        aitoTableName: mainTableName,
        oldAitoTableName,
        tableId: table.id,
        viewId: mainViewId,
        tasks,
      })
    } catch (e) {
      console.error(e)
      setIsUploading(false)
    }
  }

  const isReady = linkFields.every(
    (fieldId) => typeof linkedTableData.find((mapping) => mapping.fieldId === fieldId)?.recordCount === 'number',
  )

  return (
    <Box display="flex" flexDirection="column" height="0px" overflow="auto" {...flexItem}>
      <Box flexGrow={1}>
        <Box paddingX={3} paddingTop={2}>
          <Heading size="small">Choose training data</Heading>
          <Text variant="paragraph">
            Training data is required for making predictions. Select or create a <em>grid view</em> to use for training.
            The records and fields that are visible will be uploaded to your Aito cloud instance.{' '}
            <InlineLink href="https://aito.ai/help/airtable">
              <InlineIcon name="share1" />
              More
            </InlineLink>
          </Text>
        </Box>
        <Box margin={3}>
          <FormField label="Training data view" marginBottom={1}>
            <ViewPicker
              allowedTypes={[ViewType.GRID]}
              table={table}
              view={selectedView}
              disabled={!canUpdateSettings}
              onChange={(view) => view && setLinkedTableViewMapping((current) => ({ ...current, mainViewId: view.id }))}
              placeholder="Select Grid View..."
            />
          </FormField>
          {selectedView && (
            <React.Suspense fallback={<Spinner />}>
              <LinkedTableDataSourcePicker
                table={table}
                view={selectedView}
                disabled={!canUpdateSettings}
                aitoTableName={linkedTableViewMapping.mainTableName}
                onChange={setLinkedTableViewMapping}
                linkedTableViewMapping={linkedTableViewMapping}
              />
            </React.Suspense>
          )}
          <Box marginTop={2}>
            <Label>Aito.ai instance</Label>
            <Text>{client.name}</Text>
          </Box>
        </Box>
        <Box marginX={3} marginTop={3} marginBottom={2} display="flex">
          <Button disabled={!isReady || isUploading} onClick={doUpload} variant="primary" icon="upload">
            Train with {isReady ? totalRecords : 'some'} records{totalLinks > 0 ? ` and ${totalLinks} links` : null}
          </Button>
        </Box>
      </Box>
      <Box margin={3} flex="none">
        <Footer />
      </Box>
    </Box>
  )
}

const InlineFieldList: React.FC<
  {
    fields: Field[]
  } & MarginProps
> = ({ fields, ...marginProps }) => (
  <Text
    overflow="hidden"
    variant="default"
    style={{
      lineHeight: '24px',
      paddingTop: '-4px',
      paddingBottom: '-4px',
      textOverflow: 'break-word',
    }}
    {...marginProps}
  >
    {fields.map((field, i) => (
      <React.Fragment key={field.id}>
        <span style={{ whiteSpace: 'nowrap', overflowWrap: 'break-word' }}>
          <InlineFieldIcon fillColor="gray" field={field} />
          &nbsp;{field.name}
        </span>
        {i + 1 < fields.length && <span style={{ letterSpacing: '24px' }}> </span>}
      </React.Fragment>
    ))}
  </Text>
)

const LinkedTableDataSourcePicker: React.FC<{
  table: Table
  aitoTableName: string
  view: View
  linkedTableViewMapping: LinkedTableViewMapping
  onChange: (update: (oldSource: LinkedTableViewMapping) => LinkedTableViewMapping) => void
  disabled: boolean
}> = ({ table, view, aitoTableName, linkedTableViewMapping, onChange, disabled }) => {
  const viewMetadata = useViewMetadata(view)
  const visibleFields = viewMetadata.visibleFields
  const linkedTableData = linkedTableViewMapping.linkedTableData

  const base = useBase()

  type IsMultipleRecordLinks = {
    type: FieldType.MULTIPLE_RECORD_LINKS
    config: { type: FieldType.MULTIPLE_RECORD_LINKS }
  }

  const linkFields = visibleFields.filter(
    (field): field is Field & IsMultipleRecordLinks => field.type === FieldType.MULTIPLE_RECORD_LINKS,
  )

  const records = useRecords(view, { fields: linkFields })

  const linkIdsToViews = linkFields.reduce<globalThis.Record<string, [Table, View]>>((acc, field) => {
    const config = field.config
    const tableId = config.options.linkedTableId

    const linkedTable = base.getTableByIdIfExists(tableId)
    if (!linkedTable) {
      console.warn('Table %s linked from field %s cannot be found', tableId, field.id)
      return acc
    }

    const configuredViewId = linkedTableData.find(({ fieldId }) => fieldId === field.id)?.viewId
    const configuredView = configuredViewId && linkedTable.getViewByIdIfExists(configuredViewId)
    const linkedView = configuredView || linkedTable.getFirstViewOfType(ViewType.GRID)
    if (!linkedView) {
      console.warn('Table %s linked from field %s has no grid view', tableId, field.id)
      return acc
    }

    return {
      ...acc,
      [field.id]: [linkedTable, linkedView],
    }
  }, {})

  const acceptedFields = viewMetadata.visibleFields.filter(isAcceptedField)
  const includedFields = acceptedFields.filter((x) => !isIgnoredField(x))
  const excludedFields = acceptedFields.filter(isIgnoredField)

  const recordCount = records.length
  const linkCount = records.reduce<number>(
    (acc, record) =>
      acc +
      linkFields.reduce<number>((acc, field) => {
        const value = record.getCellValue(field)
        return Array.isArray(value) ? acc + value.length : acc
      }, 0),
    0,
  )

  const linkIdList = useEqualValue(linkFields.map((field) => field.id))

  // Update record and link count
  useEffect(() => {
    onChange((current) => ({
      ...current,
      linkCount,
      recordCount,
      linkFields: linkIdList,
    }))
  }, [onChange, recordCount, linkCount, linkIdList])

  const setLinkedView = (field: Field & IsMultipleRecordLinks) => (newView: View | null) => {
    if (newView) {
      onChange((current) => {
        return {
          ...current,
          linkedTableData: current.linkedTableData.map((mapping) => {
            if (mapping.fieldId === field.id) {
              return {
                aitoTableName: `${aitoTableName}_${newView.id}`,
                fieldId: field.id,
                tableId: field.config.options.linkedTableId,
                viewId: newView.id,
              }
            } else {
              return mapping
            }
          }),
        }
      })
    }
  }

  return (
    <Box>
      <TableSource
        aitoTableName={aitoTableName}
        table={table}
        ignoredFields={excludedFields}
        viewFields={includedFields}
        linkCount={linkCount}
        recordCount={recordCount}
      />

      {linkFields.length > 0 && (
        <>
          <Heading size="small" marginTop={2}>
            Training data for linked views
          </Heading>

          <Box paddingLeft={2} borderLeft="thick" marginBottom={2}>
            {linkFields.map((field, i) => {
              const entry = linkIdsToViews[field.id]
              if (!entry) {
                // Unexpected
                return null
              }

              const [linkedTable, linkedView] = entry

              const defaultName = `${aitoTableName}_${linkedView.id}`
              const linkedName =
                linkedTableData.find((mapping) => mapping.fieldId === field.id)?.aitoTableName || defaultName

              return (
                <Box key={field.id}>
                  <Text marginTop={i > 0 ? 3 : 0}>
                    <strong>{table.name}</strong> is linked from{' '}
                    <FieldIcon style={{ verticalAlign: 'text-bottom' }} field={field} marginRight={1} />
                    {field.name}
                  </Text>
                  <Label marginTop={2}>Training data view</Label>
                  <ViewPicker
                    allowedTypes={[ViewType.GRID]}
                    table={linkedTable}
                    view={linkedView}
                    disabled={disabled}
                    onChange={setLinkedView(field)}
                    placeholder="Select Grid View..."
                  />
                  <React.Suspense fallback={<Spinner />}>
                    <LinkedTableView
                      field={field}
                      table={linkedTable}
                      view={linkedView}
                      aitoTableName={linkedName}
                      onChange={onChange}
                    />
                  </React.Suspense>
                </Box>
              )
            })}
          </Box>
        </>
      )}
    </Box>
  )
}

const LinkedTableView: React.FC<{
  field: Field
  table: Table
  view: View
  aitoTableName: string
  onChange: (update: (oldSource: LinkedTableViewMapping) => LinkedTableViewMapping) => void
}> = ({ field, table, view, aitoTableName, onChange }) => {
  const viewMetadata = useViewMetadata(view)
  const records = useRecordIds(view)

  const acceptedFields = viewMetadata.visibleFields.filter(isAcceptedField)
  const includedFields = acceptedFields.filter(isDataField)
  const excludedFields = acceptedFields.filter(isIgnoredField)

  const recordCount = records.length

  useEffect(() => {
    onChange((current) => {
      const { linkedTableData, ...rest } = current
      const newMapping = {
        fieldId: field.id,
        aitoTableName,
        tableId: table.id,
        viewId: view.id,
        recordCount,
      }

      const viewInfoExists = Boolean(linkedTableData.find((mapping) => mapping.fieldId === field.id))

      const update = {
        ...rest,
        linkedTableData: viewInfoExists
          ? linkedTableData.map((mapping) => (mapping.fieldId === field.id ? newMapping : mapping))
          : [...linkedTableData, newMapping],
      }
      if (_.isEqual(current, update)) {
        // Avoid re-render if possible
        // https://reactjs.org/docs/hooks-reference.html#functional-updates
        return current
      } else {
        return update
      }
    })
  }, [onChange, aitoTableName, field.id, table.id, view.id, recordCount])

  return (
    <TableSource
      aitoTableName={aitoTableName}
      viewFields={includedFields}
      ignoredFields={excludedFields}
      table={table}
      recordCount={recordCount}
    />
  )
}

const TableSource: React.FC<{
  table: Table
  aitoTableName: string
  recordCount?: number
  linkCount?: number
  viewFields: Field[]
  ignoredFields: Field[]
}> = ({ aitoTableName, recordCount, linkCount, viewFields, ignoredFields }) => {
  return (
    <Box marginTop={2} display="flex" flexDirection="row" flexWrap="wrap">
      <Box flexGrow={0.5} flexShrink={0.5} flexBasis="50%">
        <Label>Content</Label>
        <Text variant="paragraph">
          {recordCount || 0} records{linkCount && linkCount > 0 ? `, ${linkCount} links` : null}
        </Text>
      </Box>
      <Box flexGrow={0.5} flexShrink={0.5} flexBasis="50%">
        <Label>
          Aito dataset name
          <Tooltip
            placementY={Tooltip.placements.TOP}
            style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
            content="This is the name of the table that is created in your Aito.ai instance and you will be able to see it in Aito console. If a table of the same name already exists, it will be replaced."
          >
            <InlineIcon name="help" marginLeft={1} marginRight={0} />
          </Tooltip>
        </Label>
        <Text variant="paragraph" style={{ overflowWrap: 'break-word' }}>
          {aitoTableName}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={0} flexBasis="100%">
        <Label>Fields</Label>
        <InlineFieldList fields={viewFields} />
      </Box>
      {ignoredFields.length > 0 && (
        <Box flexGrow={1} flexShrink={0} flexBasis="100%" marginTop={2}>
          <Label>
            Excluded fields
            <Tooltip
              placementY={Tooltip.placements.TOP}
              style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
              content="Button fields, attachment fields and lookup fields are not supported and will not be uploaded to your Aito dataset. These fields cannot be predicted."
            >
              <InlineIcon name="help" marginLeft={1} marginRight={0} />
            </Tooltip>
          </Label>
          <InlineFieldList fields={ignoredFields} />
        </Box>
      )}
    </Box>
  )
}

export default UploadConfigView
