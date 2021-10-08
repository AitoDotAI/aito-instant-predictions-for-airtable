import { Cursor, Table, View } from '@airtable/blocks/models'
import { Box, Text, Button, Loader } from '@airtable/blocks/ui'
import React from 'react'
import AitoClient from '../AitoClient'
import { UploadResult } from '../functions/uploadView'
import { TableConfig } from '../schema/config'
import PredictView from './PredictView'
import { Tab } from './Tab'
import UploadView from './UploadView'

const TableView: React.FC<{
  table: Table
  cursor: Cursor
  tableConfig: TableConfig
  client: AitoClient | null
  onUpload: (view: View, aitoTableName: string) => Promise<UploadResult | undefined>
  setTableConfig: (table: Table, tableConfig: TableConfig) => Promise<unknown>
  canUpdateSettings: boolean
  tab: Tab
  setTab: (tab: Tab) => unknown
}> = ({ table, cursor, client, onUpload, tableConfig, setTableConfig, canUpdateSettings, tab, setTab }) => {
  if (!client) {
    return (
      <Text variant="paragraph" textColor="light">
        Please setup your Aito.ai instance credentials in the settings view.
      </Text>
    )
  }

  if (tab === 'train') {
    return (
      <Box display="flex" flexDirection="column" minHeight="100vh">
        <React.Suspense fallback={<Spinner />}>
          <UploadView
            key={table.id}
            table={table}
            tableConfig={tableConfig}
            onUpload={onUpload}
            setTableConfig={setTableConfig}
            canUpdateSettings={canUpdateSettings}
            client={client}
            setTab={setTab}
          />
        </React.Suspense>
      </Box>
    )
  } else {
    // tab === 'predict
    const view = tableConfig.airtableViewId ? table.getViewByIdIfExists(tableConfig.airtableViewId) : null
    const lastUpdated = tableConfig && tableConfig.lastRowCount && tableConfig.lastUpdated
    const hasUploaded = Boolean(lastUpdated)

    return (
      <Box display="flex" flexDirection="column" minHeight="100vh">
        <Box flexGrow={1} flexBasis="100%">
          <React.Suspense fallback={<Spinner />}>
            <PredictView
              key={table.id}
              table={table}
              cursor={cursor}
              tableConfig={tableConfig}
              client={client}
              hasUploaded={hasUploaded}
            />
          </React.Suspense>
        </Box>
        <Box padding={1} borderTop="thick" display="flex" backgroundColor="#f0f0f0" flexGrow={0}>
          <Text variant="paragraph" flexGrow={1} size="default" padding={1} margin={0}>
            {lastUpdated ? (
              <>
                {tableConfig.lastRowCount} records from <em>{view ? view.name : 'a removed view'}</em> uploaded at{' '}
                {new Date(lastUpdated).toLocaleDateString()}
              </>
            ) : (
              'No training data has been uploaded yet.'
            )}
          </Text>
          <Button
            flexGrow={0}
            size="small"
            style={{ height: 'auto' }}
            alignSelf="stretch"
            onClick={() => setTab('train')}
            variant="primary"
            disabled={!canUpdateSettings}
          >
            {hasUploaded ? 'Retrain' : 'Train'} model
          </Button>
        </Box>
      </Box>
    )
  }
}

const Spinner: React.FC = () => (
  <Box padding={3} display="flex" justifyContent="center" alignItems="center">
    <Loader scale={0.3} />
  </Box>
)

export default TableView
