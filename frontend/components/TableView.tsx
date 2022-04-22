import { Cursor, Table } from '@airtable/blocks/models'
import { Box, Text, Button, Tooltip } from '@airtable/blocks/ui'
import React from 'react'
import AitoClient from '../AitoClient'
import { TableConfig } from '../schema/config'
import PredictView from './PredictView'
import Spinner from './Spinner'
import { Tab } from './Tab'
import { BORDER_STYLE, GRAY_BACKGROUND, InlineIcon } from './ui'
import UploadConfigView, { UploadJob } from './UploadConfigView'

const TableView: React.FC<{
  table: Table
  cursor: Cursor
  tableConfig: TableConfig
  client: AitoClient
  onUpload: (job: UploadJob) => unknown
  canUpdateSettings: boolean
  tab: Tab
  setTab: (tab: Tab) => unknown
}> = ({ table, cursor, client, onUpload, tableConfig, canUpdateSettings, tab, setTab }) => {
  const view = tableConfig.airtableViewId ? table.getViewByIdIfExists(tableConfig.airtableViewId) : null
  const viewName = view ? view.name : undefined
  const lastUpdated = tableConfig && tableConfig.lastRowCount && tableConfig.lastUpdated
  const hasUploaded = Boolean(lastUpdated)
  const rowCount = tableConfig.lastRowCount
  const linkedRowCount = (tableConfig.views || []).reduce((acc, view) => acc + view.lastRowCount, 0)
  const linkCount = Object.values(tableConfig.links || {}).reduce((acc, table) => acc + table.lastRowCount, 0)

  const footer = (
    <Footer
      viewName={viewName}
      lastRowCount={rowCount && rowCount + linkedRowCount}
      lastLinkCount={rowCount && linkCount}
      buttonVariant={tab === 'predict' ? 'primary' : 'secondary'}
      lastUpdated={lastUpdated ? new Date(lastUpdated) : undefined}
      lastUploadedBy={tableConfig.lastUpdatedBy?.name}
      buttonDisabled={tab === 'predict' && !canUpdateSettings}
      buttonText={tab === 'predict' ? `${hasUploaded ? 'Retrain' : 'Train'} Aito` : 'Cancel'}
      onButtonClick={tab === 'predict' ? () => setTab('train') : () => setTab('predict')}
      buttonKey={tab}
    />
  )

  if (tab === 'train') {
    return (
      <Box display="flex" flexDirection="column" height="100vh">
        <React.Suspense fallback={<Spinner />}>
          <UploadConfigView
            key={table.id}
            table={table}
            tableConfig={tableConfig}
            onUpload={onUpload}
            canUpdateSettings={canUpdateSettings}
            client={client}
            flexGrow={1}
          />
        </React.Suspense>
        {footer}
      </Box>
    )
  } else {
    // tab === 'predict
    return (
      <Box display="flex" flexDirection="column" height="100vh">
        <React.Suspense fallback={<Spinner />}>
          <PredictView
            key={table.id}
            table={table}
            cursor={cursor}
            tableConfig={tableConfig}
            client={client}
            hasUploaded={hasUploaded}
            flexGrow={1}
          />
        </React.Suspense>
        {footer}
      </Box>
    )
  }
}

const Footer: React.FC<{
  lastUpdated?: Date | undefined
  lastRowCount?: number | undefined
  lastLinkCount?: number | undefined
  lastUploadedBy?: string | undefined
  viewName?: string | undefined
  buttonText: string
  buttonDisabled: boolean
  buttonVariant: 'primary' | 'secondary'
  onButtonClick: () => void
  buttonKey: string
}> = ({
  lastUpdated,
  lastRowCount = 0,
  lastLinkCount = 0,
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
    borderTop={BORDER_STYLE}
    display="flex"
    backgroundColor={GRAY_BACKGROUND}
    justifyContent="space-between"
    flex="none"
  >
    <Tooltip
      style={{ height: 'auto', width: '300px', maxWidth: '300px', whiteSpace: 'normal' }}
      fitInWindowMode={Tooltip.fitInWindowModes.NUDGE}
      placementX={Tooltip.placements.LEFT}
      placementY={Tooltip.placements.TOP}
      disabled={!lastUpdated}
      content={() => (
        <Text margin={2} textColor="white">
          {lastUploadedBy || 'Somebody'} trained with {lastRowCount} records{' '}
          {lastLinkCount > 0 && <> and {lastLinkCount} links</>} from <em>{viewName || 'an old view'}</em> at{' '}
          {lastUpdated ? new Date(lastUpdated).toLocaleString() : 'some point in time'}.
        </Text>
      )}
    >
      <Box flexGrow={0}>
        <Text variant="paragraph" size="default" padding={1} margin={0}>
          {lastUpdated ? (
            <>
              <InlineIcon name="info" fillColor="#aaa" />
              Last trained {lastUpdated.toLocaleDateString()}
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
