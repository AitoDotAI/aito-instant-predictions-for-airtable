import { Table, View } from '@airtable/blocks/models'
import { Box, Text, useViewMetadata, useWatchable } from '@airtable/blocks/ui'
import React from 'react'
import AitoClient from '../AitoClient'
import { mapColumnNames } from '../functions/inferAitoSchema'
import { TableSchema } from '../schema/aito'
import { TableConfig } from '../schema/config'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import Spinner from './Spinner'
import { InlineIcon } from './ui'
import useAitoSchema from './useAitoSchema'

const WithTableSchema = (props: {
  table: Table
  view?: View | null
  tableConfig: TableConfig
  client: AitoClient
  hasUploaded: boolean
  children: (params: { schema: TableSchema }) => React.ReactElement | null
}) => {
  const { table, view = null, tableConfig, client, hasUploaded, children } = props

  // Use the current view for predictions, not necessarily the one used for training/upload
  const metadata = useViewMetadata(view)
  const aitoTableName = tableConfig.aitoTableName
  const tableColumnMap = tableConfig.columns

  const schema = useAitoSchema(aitoTableName, client)

  // Make sure that the selected rows and fields are up to date
  useWatchable(metadata, 'visibleFields')

  if (schema === 'quota-exceeded') {
    return (
      <Box margin={3}>
        <QueryQuotaExceeded />
      </Box>
    )
  }

  if (!schema || !hasUploaded) {
    if (schema === null || !hasUploaded) {
      // No table with that name
      return (
        <Text variant="paragraph" margin={3}>
          There doesn&apos;t seem to be any training data for <em>{table.name}</em> in your Aito instance. Please upload
          training data first by clicking on the button at the bottom.
        </Text>
      )
    } else {
      // Still loading table, show nothing
      return <Spinner />
    }
  }

  const currentTableColumnMap = mapColumnNames(metadata ? metadata.visibleFields : table.fields)
  const isSchemaOutOfSync = !!Object.entries(currentTableColumnMap).find(([fieldId, { type }]) => {
    const uploaded = tableColumnMap[fieldId]
    return uploaded && uploaded.type !== type
  })

  if (isSchemaOutOfSync) {
    return (
      <Box display="flex" margin={3}>
        <Text variant="paragraph" flexGrow={0}>
          <InlineIcon flexGrow={0} name="warning" aria-label="Warning" fillColor="#aaa" />
        </Text>

        <Text variant="paragraph" flexGrow={1}>
          The fields have changed since training data was last uploaded to Aito. Please retrain the model.
        </Text>
      </Box>
    )
  }

  return children({ schema })
}

export default WithTableSchema
