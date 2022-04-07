import { Field, FieldType, Table, View, ViewType } from '@airtable/blocks/models'
import {
  Box,
  Button,
  FieldIcon,
  FormField,
  Icon,
  Loader,
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
import React, { useEffect, useState } from 'react'
import { isAcceptedField, isDataField, isIgnoredField } from '../AcceptedFields'
import AitoClient from '../AitoClient'
import { describeTasks, UploadTask } from '../functions/uploadView'
import { TableConfig } from '../schema/config'
import Footer from './Footer'
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
  tasks: UploadTask[]
}

const UploadView: React.FC<{
  table: Table
  tableConfig: TableConfig
  onUpload: (job: UploadJob) => unknown
  canUpdateSettings: boolean
  client: AitoClient
}> = ({ table, tableConfig, canUpdateSettings, client, onUpload }) => {
  const base = useBase()

  const [linkedTableViewMapping, setLinkedTableViewMapping] = useState<LinkedTableViewMapping>({
    mainViewId: tableConfig.airtableViewId || null,
    mainTableName: tableConfig.aitoTableName,
    linkFields: [],
    linkedTableData: tableConfig.links
      ? Object.entries(tableConfig.links).map(([fieldId, link]) => {
          return {
            fieldId,
            aitoTableName: link.aitoTableName,
            tableId: link.airtableTableId,
            viewId: link.airtableViewId,
          }
        })
      : [],
  })

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
    <>
      <Box display="flex" flexGrow={1} flexDirection="column">
        <Box flexGrow={1}>
          <Box paddingX={3} paddingTop={2}>
            <Heading size="small">Select view</Heading>
            <Text variant="paragraph" textColor="light">
              Training data is required for making predictions. Select or create a <em>grid view</em> to use for
              training. The records and fields that are visible can be uploaded to your Aito cloud instance. More tips
              at Aito.ai{' '}
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
                view={selectedView}
                disabled={!canUpdateSettings}
                onChange={(view) =>
                  view && setLinkedTableViewMapping((current) => ({ ...current, mainViewId: view.id }))
                }
                placeholder="Select Grid View..."
              />
            </FormField>
            {selectedView && (
              <React.Suspense
                fallback={
                  <Box display="flex" flexDirection="column" minHeight="240px" justifyContent="center">
                    <Loader scale={0.3} alignSelf="center" />
                  </Box>
                }
              >
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
          </Box>
          <Box marginX={3} marginTop={4} marginBottom={2} display="flex" justifyContent="center">
            <Button disabled={!isReady || isUploading} onClick={doUpload} variant="primary" icon="upload">
              Upload {isReady ? totalRecords : 'some'} records{totalLinks > 0 ? ` and ${totalLinks} links` : null} to{' '}
              <strong>{client.name}</strong>
            </Button>
          </Box>
        </Box>
        <Box margin={3} flexGrow={0}>
          <Footer />
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
      <React.Fragment key={field.id}>
        <span style={{ whiteSpace: 'nowrap', overflowWrap: 'break-word' }}>
          <FieldIcon marginRight={1} style={{ verticalAlign: 'text-bottom' }} fillColor="gray" field={field} />
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

    const table = base.getTableByIdIfExists(tableId)
    if (!table) {
      console.warn('Table %s linked from field %s cannot be found', tableId, field.id)
      return acc
    }

    const configuredViewId = linkedTableViewMapping.linkedTableData.find(
      (mapping) => mapping.fieldId === field.id,
    )?.viewId
    const configuredView = configuredViewId && table.getViewByIdIfExists(configuredViewId)
    const view = configuredView || table.getFirstViewOfType(ViewType.GRID)
    if (!view) {
      console.warn('Table %s linked from field %s has no grid view', tableId, field.id)
      return acc
    }

    return {
      ...acc,
      [field.id]: [table, view],
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

  // Update record and link count
  useEffect(() => {
    onChange((current) => ({
      ...current,
      linkCount: linkCount,
      recordCount,
    }))
  }, [onChange, recordCount, linkCount])

  const linkIdList = useEqualValue(linkFields.map((field) => field.id))

  useEffect(() => {
    onChange((current) => ({
      ...current,
      linkFields: linkIdList,
    }))
  }, [onChange, linkIdList])

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
          <Heading size="small">Select linked views</Heading>

          <Box paddingLeft={2} borderLeft="thick">
            {linkFields.map((field, i) => {
              const entry = linkIdsToViews[field.id]
              if (!entry) {
                // Unexpected
                return null
              }

              const [linkedTable, linkedView] = entry

              const defaultName = `${aitoTableName}_${view.id}`
              const linkedName =
                linkedTableViewMapping.linkedTableData.find((mapping) => mapping.fieldId === field.id)?.aitoTableName ||
                defaultName

              return (
                <React.Fragment key={field.id}>
                  <Text marginTop={i > 0 ? 3 : 0}>
                    <strong>{table.name}</strong> is linked from{' '}
                    <FieldIcon style={{ verticalAlign: 'text-bottom' }} field={field} />
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
                  <React.Suspense
                    fallback={
                      <Box display="flex" flexDirection="column" minHeight="240px" justifyContent="center">
                        <Loader scale={0.3} alignSelf="center" />
                      </Box>
                    }
                  >
                    <LinkedTableView
                      field={field}
                      table={linkedTable}
                      view={linkedView}
                      aitoTableName={linkedName}
                      onChange={onChange}
                    />
                  </React.Suspense>
                </React.Fragment>
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
    onChange(({ linkedTableData, ...rest }) => {
      if (linkedTableData.find((mapping) => mapping.fieldId === field.id)) {
        return {
          ...rest,
          linkedTableData: linkedTableData.map((mapping) => {
            if (mapping.fieldId === field.id) {
              return {
                ...mapping,
                recordCount,
              }
            } else {
              return mapping
            }
          }),
        }
      } else {
        return {
          ...rest,
          linkedTableData: [
            ...linkedTableData,
            {
              fieldId: field.id,
              aitoTableName,
              tableId: table.id,
              viewId: view.id,
              recordCount,
            },
          ],
        }
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
          Aito table name
          <Tooltip
            style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
            content="This is the table name that is created in your Aito instance and you will be able to see it in Aito console. If a table of the same name already exists, it will be replaced."
          >
            <Icon name="help" style={{ verticalAlign: 'bottom' }} marginLeft={1} />
          </Tooltip>
        </Label>
        <Text variant="paragraph">{aitoTableName}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={0} flexBasis="100%">
        <Label>Fields</Label>
        <InlineFieldList fields={viewFields} />
      </Box>
      {ignoredFields.length > 0 && (
        <Box flexGrow={1} flexShrink={0} flexBasis="100%">
          <Label>
            Excluded fields{' '}
            <Tooltip
              style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
              content="Button fields, attachment fields and lookup fields are not supported and will not be uploaded to your Aito table. These fields cannot be predicted."
            >
              <Icon name="help" style={{ verticalAlign: 'bottom' }} marginLeft={1} />
            </Tooltip>
          </Label>
          <InlineFieldList fields={ignoredFields} />
        </Box>
      )}
    </Box>
  )
}

export default UploadView
