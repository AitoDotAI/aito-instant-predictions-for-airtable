import { Table, View, ViewType } from '@airtable/blocks/models'
import { useBase, useCursor, useGlobalConfig, useSettingsButton, ViewportConstraint } from '@airtable/blocks/ui'
import React, { useCallback, useState } from 'react'
import * as GlobalConfigKeys from '../GlobalConfigKeys'
import SettingsMenu, { Settings } from './SettingsMenu'
import TableView from './TableView'

import { isBoolean, isString } from '../validator/validation'
import { isTableConfig, isTablesConfig, TableConfig, UserConfig } from '../schema/config'
import OnboardingDialog from './OnboardingDialog'
import GlobalConfig from '@airtable/blocks/dist/types/src/global_config'
import { useMemo } from 'react'
import AitoClient from '../AitoClient'
import { Tab } from './Tab'
import { UploadResult, uploadView } from '../functions/uploadView'
import { LocalConfig, readLocalConfig, writeLocalConfig } from '../LocalConfig'

const VIEWPORT_MIN_WIDTH = 345
const VIEWPORT_MIN_HEIGHT = 200
const VIEWPORT_FULLSCREEN_MAX_WIDTH = 600

const asBoolean = (value: unknown): boolean | undefined => {
  if (isBoolean(value)) {
    return value
  }
}

const asString = (value: unknown): string | undefined => {
  if (isString(value)) {
    return value
  }
}

const asTablesConfig = (value: unknown): Record<string, TableConfig> | undefined => {
  if (isTablesConfig(value)) {
    return value
  }
}

const AitoUploaderApp: React.FC = () => {
  // useBase will re-render the app whenever the base's configuration changes: this includes
  // updates to names, descriptions and field options, as well as tables/fields being added or
  // removed. This means the app will always show the latest structure.
  const globalConfig = useGlobalConfig()
  const hasSetupOnce = asBoolean(globalConfig.get(GlobalConfigKeys.HAS_SETUP_ONCE))

  const [localConfig, setLocalConfig] = useState(readLocalConfig)
  const saveAndSetLocalConfig = useCallback(
    (newLocalConfig: UserConfig): void => {
      setLocalConfig(newLocalConfig)
      writeLocalConfig(newLocalConfig)
    },
    [setLocalConfig],
  )
  const savedTuple = useMemo(() => [localConfig, saveAndSetLocalConfig] as const, [localConfig, saveAndSetLocalConfig])

  if (!hasSetupOnce) {
    return <OnboardingDialog globalConfig={globalConfig} />
  } else {
    return (
      <ViewportConstraint
        minSize={{
          width: VIEWPORT_MIN_WIDTH,
          height: VIEWPORT_MIN_HEIGHT,
        }}
        maxFullscreenSize={{
          width: VIEWPORT_FULLSCREEN_MAX_WIDTH,
        }}
      >
        <LocalConfig.Provider value={savedTuple}>
          <MainView globalConfig={globalConfig} />
        </LocalConfig.Provider>
      </ViewportConstraint>
    )
  }
}

const MainView: React.FC<{
  globalConfig: GlobalConfig
}> = ({ globalConfig }) => {
  // useBase will re-render the app whenever the base's configuration changes: this includes
  // updates to names, descriptions and field options, as well as tables/fields being added or
  // removed. This means the app will always show the latest structure.
  const base = useBase()
  const cursor = useCursor()
  const aitoUrl = asString(globalConfig.get(GlobalConfigKeys.AITO_URL))
  const aitoKey = asString(globalConfig.get(GlobalConfigKeys.AITO_KEY))

  const canUpdateSettings = globalConfig.hasPermissionToSet()

  // Use settings menu to hide away table pickers
  const [isShowingSettings, setIsShowingSettings] = useState(false)
  useSettingsButton(() => {
    setIsShowingSettings(!isShowingSettings)
  })

  const client = useMemo(() => (aitoUrl && aitoKey ? new AitoClient(aitoUrl, aitoKey) : null), [aitoUrl, aitoKey])

  const uploadButtonClick = useCallback(
    async (view: View, aitoTable: string): Promise<UploadResult | undefined> => {
      if (aitoTable && client) {
        return await uploadView(client, view, aitoTable)
      }
    },
    [client],
  )

  const onSaveSettings = useCallback(
    async (settings: Settings): Promise<void> => {
      await globalConfig.setPathsAsync([
        { path: [GlobalConfigKeys.AITO_URL], value: settings.aitoUrl },
        { path: [GlobalConfigKeys.AITO_KEY], value: settings.aitoKey },
      ])
      setIsShowingSettings(false)
    },
    [globalConfig, setIsShowingSettings],
  )

  const setTableConfig = useCallback(
    (table: Table, config: TableConfig): Promise<void> => {
      return globalConfig.setAsync([GlobalConfigKeys.TABLE_SETTINGS, table.id], isTableConfig.strip(config))
    },
    [globalConfig],
  )

  const [tab, setTab] = useState<Tab>('predict')

  if (isShowingSettings || !client) {
    const settings: Settings = {
      aitoUrl: aitoUrl || '',
      aitoKey: aitoKey || '',
    }

    return (
      <SettingsMenu
        globalConfig={globalConfig}
        settings={settings}
        canUpdateSettings={canUpdateSettings}
        onDoneClick={onSaveSettings}
      />
    )
  } else {
    // table can be null if it's a new table being created and activeViewId can be null while the
    // table is loading, so we use "ifExists" to allow for these situations.
    const table = cursor.activeTableId ? base.getTableByIdIfExists(cursor.activeTableId) : null
    const tablesConfig = table && asTablesConfig(globalConfig.get([GlobalConfigKeys.TABLE_SETTINGS]))

    if (table) {
      let tableConfig = tablesConfig?.[table.id]
      let viewId: string | undefined = tableConfig?.airtableViewId

      const activeView = cursor.activeViewId !== null ? table.getViewByIdIfExists(cursor.activeViewId) : null

      // Look for a default view if none was configured
      if (!viewId) {
        if (activeView?.type === ViewType.GRID) {
          viewId = activeView.id
        } else {
          const hit = table.views.find((v) => v.type === ViewType.GRID)
          if (hit) {
            viewId = hit.id
          }
        }
      }

      const defaultTableConfig = {
        aitoTableName: `airtable-${table.id}`,
        airtableViewId: viewId,
        lastRowCount: undefined,
        lastUpdated: undefined,
        lastUpdatedBy: undefined,
        ...tableConfig,
      }

      return (
        <TableView
          table={table}
          cursor={cursor}
          client={client}
          tableConfig={defaultTableConfig}
          onUpload={uploadButtonClick}
          canUpdateSettings={canUpdateSettings}
          setTableConfig={setTableConfig}
          tab={tab}
          setTab={setTab}
        />
      )
    } else {
      // Still loading table and/or view.
      return null
    }
  }
}

export default AitoUploaderApp
