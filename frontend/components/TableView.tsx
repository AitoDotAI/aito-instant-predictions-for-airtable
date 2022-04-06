import { Cursor, Table } from '@airtable/blocks/models'
import { Box, Text, Button, Loader, Tooltip, Icon } from '@airtable/blocks/ui'
import React from 'react'
import AitoClient from '../AitoClient'
import { TableConfig } from '../schema/config'
import PredictView from './PredictView'
import { Tab } from './Tab'
import UploadView, { UploadJob } from './UploadView'

const TableView: React.FC<{
  table: Table
  cursor: Cursor
  tableConfig: TableConfig
  client: AitoClient | null
  onUpload: (job: UploadJob) => unknown
  canUpdateSettings: boolean
  tab: Tab
  setTab: (tab: Tab) => unknown
}> = ({ table, cursor, client, onUpload, tableConfig, canUpdateSettings, tab, setTab }) => {
  if (!client) {
    return (
      <Text variant="paragraph" textColor="light">
        Please setup your Aito.ai instance credentials in the settings view.
      </Text>
    )
  }

  const view = tableConfig.airtableViewId ? table.getViewByIdIfExists(tableConfig.airtableViewId) : null
  const viewName = view ? view.name : undefined
  const lastUpdated = tableConfig && tableConfig.lastRowCount && tableConfig.lastUpdated
  const hasUploaded = Boolean(lastUpdated)

  const footer = (
    <Footer
      viewName={viewName}
      lastRowCount={tableConfig.lastRowCount}
      buttonVariant={tab === 'predict' ? 'primary' : 'secondary'}
      lastUpdated={lastUpdated ? new Date(lastUpdated) : undefined}
      lastUploadedBy={tableConfig.lastUpdatedBy?.name}
      buttonDisabled={tab === 'predict' && !canUpdateSettings}
      buttonText={tab === 'predict' ? `${hasUploaded ? 'Retrain' : 'Train'} model` : 'Cancel'}
      onButtonClick={tab === 'predict' ? () => setTab('train') : () => setTab('predict')}
      buttonKey={tab}
    />
  )

  if (tab === 'train') {
    return (
      <Box display="flex" flexDirection="column" minHeight="100vh">
        <Box display="flex" flexGrow={1} flexBasis="100%">
          <React.Suspense fallback={<Spinner />}>
            <UploadView
              key={table.id}
              table={table}
              tableConfig={tableConfig}
              onUpload={onUpload}
              canUpdateSettings={canUpdateSettings}
              client={client}
            />
          </React.Suspense>
        </Box>
        {footer}
      </Box>
    )
  } else {
    // tab === 'predict
    return (
      <Box display="flex" flexDirection="column" minHeight="100vh">
        <Box flexGrow={1} flexBasis="100%" display="flex" flexDirection="column">
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
        {footer}
      </Box>
    )
  }
}

const Spinner: React.FC = () => (
  <Box padding={3} flexGrow={1} display="flex" flexBasis="100%" justifyContent="center" alignItems="center">
    <Loader scale={0.3} />
  </Box>
)

const Footer: React.FC<{
  lastUpdated: Date | undefined
  lastRowCount: number | undefined
  lastUploadedBy: string | undefined
  viewName: string | undefined
  buttonText: string
  buttonDisabled: boolean
  buttonVariant: 'primary' | 'secondary'
  onButtonClick: () => void
  buttonKey: string
}> = ({
  lastUpdated,
  lastRowCount = 0,
  lastUploadedBy,
  viewName,
  buttonVariant,
  buttonText,
  buttonDisabled,
  onButtonClick,
  buttonKey,
}) => (
  <Box
    padding={1}
    borderTop="thick"
    display="flex"
    backgroundColor="#f0f0f0"
    flexGrow={0}
    justifyContent="space-between"
  >
    <Tooltip
      style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
      fitInWindowMode={Tooltip.fitInWindowModes.NUDGE}
      placementX={Tooltip.placements.LEFT}
      placementY={Tooltip.placements.TOP}
      disabled={!lastUpdated}
      content={() => (
        <Text margin={2} textColor="white">
          {lastUploadedBy || 'Somebody'} uploaded {lastRowCount} records from <em>{viewName || 'an old view'}</em> at{' '}
          {lastUpdated ? new Date(lastUpdated).toLocaleString() : 'some point in time'}.
        </Text>
      )}
    >
      <Box flexGrow={0}>
        <Text variant="paragraph" size="default" padding={1} margin={0}>
          {lastUpdated ? (
            <>
              <Icon name="info" style={{ verticalAlign: 'text-bottom' }} marginRight={1} />
              Records last uploaded {lastUpdated.toLocaleDateString()}
            </>
          ) : (
            'No data has been uploaded for this table yet'
          )}
        </Text>
      </Box>
    </Tooltip>
    <Button
      flexGrow={0}
      size="small"
      style={{ height: 'auto' }}
      alignSelf="stretch"
      onClick={onButtonClick}
      variant={buttonVariant}
      disabled={buttonDisabled}
      key={buttonKey}
    >
      {buttonText}
    </Button>
  </Box>
)

export default TableView
