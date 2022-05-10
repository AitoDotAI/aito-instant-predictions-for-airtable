import { FlexItemSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Cursor, Table } from '@airtable/blocks/models'
import { Box, Text, Button, Tooltip } from '@airtable/blocks/ui'
import React, { useState } from 'react'
import AitoClient from '../AitoClient'
import { TableConfig } from '../schema/config'
import AitoLogo from './AitoLogo'
import PredictView from './PredictView'
import RelateView from './RelateView'
import SimilarityView from './SimilarityView'
import Spinner from './Spinner'
import { isTab, Tab } from './Tab'
import { TabGroup, TabOption } from './TabGroup'
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

  const [showUploadView, setShowUploadView] = useState(false)

  return (
    <Box display="flex" flexDirection="column" height="100vh">
      <Header tab={showUploadView ? null : tab} setTab={(tab) => (setShowUploadView(false), setTab(tab))} flex="none" />
      <React.Suspense fallback={<Spinner />}>
        {showUploadView ? (
          <UploadConfigView
            key={table.id}
            table={table}
            tableConfig={tableConfig}
            onUpload={onUpload}
            canUpdateSettings={canUpdateSettings}
            client={client}
            flexGrow={1}
          />
        ) : tab === 'predict' ? (
          <PredictView
            key={table.id}
            table={table}
            cursor={cursor}
            tableConfig={tableConfig}
            client={client}
            hasUploaded={hasUploaded}
            flexGrow={1}
            flexShrink={1}
          />
        ) : tab === 'search' ? (
          <SimilarityView
            client={client}
            table={table}
            cursor={cursor}
            tableConfig={tableConfig}
            hasUploaded={hasUploaded}
            flexGrow={1}
            flexShrink={1}
          />
        ) : tab === 'insights' ? (
          <RelateView
            client={client}
            table={table}
            cursor={cursor}
            tableConfig={tableConfig}
            hasUploaded={hasUploaded}
            flexGrow={1}
            flexShrink={1}
          />
        ) : (
          <Box flexGrow={1} />
        )}
      </React.Suspense>
      <Footer
        viewName={viewName}
        lastRowCount={rowCount && rowCount + linkedRowCount}
        lastLinkCount={rowCount && linkCount}
        buttonVariant="primary"
        lastUpdated={lastUpdated ? new Date(lastUpdated) : undefined}
        lastUploadedBy={tableConfig.lastUpdatedBy?.name}
        buttonDisabled={showUploadView || !canUpdateSettings}
        buttonText={`${hasUploaded ? 'Retrain' : 'Train'} model`}
        onButtonClick={() => setShowUploadView(true)}
        buttonKey={tab}
      />
    </Box>
  )
}

const navOptions: TabOption<Tab>[] = [
  {
    key: 'predict',
    label: 'Predict',
  },
  {
    key: 'search',
    label: 'Search',
  },
  {
    key: 'insights',
    label: 'Explain',
  },
]

const Header: React.FC<
  {
    tab: Tab | null
    setTab: (tab: Tab) => unknown
  } & FlexItemSetProps
> = ({ tab, setTab, ...flexItem }) => {
  return (
    <Box
      display="flex"
      flexDirection="row"
      {...flexItem}
      textColor="white"
      backgroundColor="#205341"
      borderBottom={BORDER_STYLE}
    >
      <TabGroup
        flexGrow={1}
        value={tab}
        onChange={(newValue) => isTab(newValue) && setTab(newValue)}
        options={navOptions}
      />

      <Box flex="none" marginX={1}>
        <AitoLogo padding={1} />
      </Box>
    </Box>
  )
}

const Footer: React.FC<{
  lastUpdated?: Date | undefined
  lastRowCount?: number | undefined
  lastLinkCount?: number | undefined
  lastUploadedBy?: string | undefined
  viewName?: string | undefined
  showButton?: boolean
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
  showButton,
}) => (
  <Box
    borderTop={BORDER_STYLE}
    padding={1}
    display="flex"
    backgroundColor="#f7f7f7"
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
      <Box flexGrow={0} alignSelf="center">
        <Text size="default" paddingX={1} margin={0}>
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
