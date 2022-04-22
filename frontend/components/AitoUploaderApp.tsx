import { ViewType } from '@airtable/blocks/models'
import {
  useBase,
  useCursor,
  useGlobalConfig,
  useSession,
  useSettingsButton,
  ViewportConstraint,
} from '@airtable/blocks/ui'
import React, { useCallback, useEffect, useState } from 'react'
import * as GlobalConfigKeys from '../GlobalConfigKeys'
import SettingsMenu, { Settings } from './SettingsMenu'
import TableView from './TableView'

import { isBoolean, isMapOf, isString, isUnknown } from '../validator/validation'
import {
  isTableConfig,
  LinkFieldConfig,
  LinkViewConfig,
  TableColumnMap,
  TableConfig,
  UserConfig,
} from '../schema/config'
import OnboardingDialog from './OnboardingDialog'
import GlobalConfig from '@airtable/blocks/dist/types/src/global_config'
import { useMemo } from 'react'
import AitoClient, { AitoError } from '../AitoClient'
import { Tab } from './Tab'
import { LocalConfig, readLocalConfig, writeLocalConfig } from '../LocalConfig'
import { normalizeAitoUrl } from '../credentials'
import UploadProgressView from './UploadProgressView'
import { UploadJob } from './UploadConfigView'
import { CreateLinkTask, CreateTableTask, runUploadTasks, UploadTask } from '../functions/uploadView'
import Spinner from './Spinner'

const VIEWPORT_MIN_WIDTH = 345
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

const isRecord = isMapOf(isUnknown)

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (isRecord(value)) {
    return value
  }
}

const asTableConfig = (value: unknown): TableConfig | undefined => {
  if (isTableConfig(value)) {
    return value
  }
}

const makeTableConfig = (
  mainTableId: string,
  mainViewId: string,
  tasks: UploadTask[],
): Pick<TableConfig, 'lastRowCount' | 'columns' | 'views' | 'links'> => {
  const findTask = <T extends UploadTask['type']>(
    type: T,
    f: (task: UploadTask & { type: T }) => boolean,
  ): (UploadTask & { type: T }) | undefined => tasks.find((t) => t.type === type && f(t as any)) as any

  const lastRowCount =
    findTask('upload-table', ({ viewId, tableId }) => tableId === mainTableId && viewId === mainViewId)?.recordCount ||
    0
  const columns: TableColumnMap =
    findTask('create-table', ({ viewId, tableId }) => tableId === mainTableId && viewId === mainViewId)?.tableInfo
      .fieldIdToName || {}

  const views = tasks
    .filter(
      (task): task is CreateTableTask =>
        task.type === 'create-table' && task.tableId !== mainTableId && task.viewId !== mainViewId,
    )
    .map<LinkViewConfig>((task) => {
      // There should be one matching upload-table task
      const uploadTask = findTask(
        'upload-table',
        ({ tableId, viewId }) => tableId === task.tableId && viewId === task.viewId,
      )
      if (!uploadTask) {
        throw new Error()
      }
      return {
        aitoTableName: uploadTask.tableInfo.aitoTable,
        airtableViewId: uploadTask.viewId,
        airtableTableId: uploadTask.tableId,
        columns: uploadTask.tableInfo.fieldIdToName,
        lastRowCount: uploadTask.recordCount || 0,
      }
    })

  const links = tasks
    .filter((task): task is CreateLinkTask => task.type === 'create-link')
    .reduce<Record<string, LinkFieldConfig>>((acc, task) => {
      // There should be one matching upload-link task
      const uploadTask = findTask('upload-link', ({ linkFieldId }) => linkFieldId === task.linkFieldId)
      if (!uploadTask) {
        throw new Error()
      }
      return {
        ...acc,
        [task.linkFieldId]: {
          aitoTableName: uploadTask.tableInfo.aitoTable,
          airtableTableId: uploadTask.tableId,
          airtableViewId: uploadTask.viewId,
          columns: uploadTask.tableInfo.fieldIdToName,
          lastRowCount: uploadTask.linkCount || 0,
        },
      }
    }, {})

  return {
    lastRowCount,
    columns,
    views,
    links,
  }
}

const AitoUploaderApp: React.FC = () => {
  return (
    <React.Suspense fallback={<Spinner />}>
      <RootView />
    </React.Suspense>
  )
}

const RootView: React.FC = () => {
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
  const tablesConfig = asRecord(globalConfig.get(GlobalConfigKeys.TABLE_SETTINGS))
  const session = useSession()

  useEffect(() => {
    // Remove table configurations of old tables
    if (!canUpdateSettings || !tablesConfig) {
      return
    }

    const oldTableIds: string[] = Object.keys(tablesConfig).filter((tableId) => !base.getTableByIdIfExists(tableId))

    if (oldTableIds.length > 0) {
      globalConfig.setPathsAsync(
        oldTableIds.map((tableId) => ({
          path: [GlobalConfigKeys.TABLE_SETTINGS, tableId],
          value: undefined,
        })),
      )
    }
  })

  // Use settings menu to hide away table pickers
  const [isShowingSettings, setIsShowingSettings] = useState(false)
  useSettingsButton(() => {
    setIsShowingSettings(!isShowingSettings)
  })

  const [isAuthenticationError, setAuthenticationError] = useState(false)

  const client = useMemo(() => {
    if (aitoUrl && aitoKey) {
      setAuthenticationError(false)
      const cl = new AitoClient(aitoUrl, aitoKey)
      cl.onAuthenticationError = () => {
        setAuthenticationError(true)
        globalConfig.setAsync(GlobalConfigKeys.AITO_KEY, undefined)
      }
      return cl
    } else {
      return null
    }
  }, [aitoUrl, aitoKey, globalConfig, setAuthenticationError])

  const [tab, setTab] = useState<Tab>('predict')

  const setTableConfig = (tableId: string, config: TableConfig): Promise<void> => {
    return globalConfig.setAsync([GlobalConfigKeys.TABLE_SETTINGS, tableId], isTableConfig.strip(config))
  }

  // Support a single upload at a time. If there's an upload on-going, then it takes
  // propority over other views (other than settings).
  const [currentUpload, setCurrentUpload] = useState<UploadJob | undefined>()
  const [uploadError, setUploadError] = useState<AitoError | undefined>()

  const uploadButtonClick = async (job: UploadJob): Promise<void> => {
    const { tableId: mainTableId, viewId: mainViewId } = job
    const now = new Date()
    const lastUpdated = now.toISOString()
    const user = session.currentUser

    if (user) {
      const newTableConfig: TableConfig = {
        aitoTableName: `airtable_${mainTableId}`,
        airtableViewId: mainViewId,
        columns: {},
        lastRowCount: undefined,
        lastUpdateStatus: 'updating',
        lastUpdated,
        lastUpdatedBy: {
          id: user.id,
          name: user.name,
        },
        links: undefined,
        views: undefined,
      }

      setCurrentUpload(job)
      setUploadError(undefined)
      await setTableConfig(mainTableId, newTableConfig)
      if (client) {
        const result = await runUploadTasks(
          base,
          client,
          job.tasks,
          (tasks) => {
            setCurrentUpload((current) => current && { ...current, tasks })
          },
          job.oldAitoTableName,
        )
        setCurrentUpload((current) => current && { ...current, task: result.tasks })
        if (result.type === 'error') {
          setUploadError(result.error)
          await setTableConfig(mainTableId, {
            ...newTableConfig,
            lastUpdateStatus: 'failed',
          })
        } else {
          const updatedConfig = makeTableConfig(mainTableId, mainViewId, result.tasks)

          setTableConfig(mainTableId, {
            ...newTableConfig,
            lastUpdateStatus: undefined,
            ...updatedConfig,
          })
        }
      } else {
        setUploadError('forbidden')
      }
    } else {
      console.error('No user session available!')
    }
  }

  const dismissUploadView = useCallback(() => {
    setTab('predict')
    setUploadError(undefined)
    setCurrentUpload(undefined)
  }, [setTab, setUploadError, setCurrentUpload])

  const onSaveSettings = useCallback(
    async (settings: Settings): Promise<void> => {
      const resetTables =
        aitoUrl && normalizeAitoUrl(aitoUrl) !== normalizeAitoUrl(settings.aitoUrl)
          ? [{ path: [GlobalConfigKeys.TABLE_SETTINGS], value: {} }]
          : []
      await globalConfig.setPathsAsync([
        { path: [GlobalConfigKeys.AITO_URL], value: settings.aitoUrl },
        { path: [GlobalConfigKeys.AITO_KEY], value: settings.aitoKey },
        ...resetTables,
      ])
      setIsShowingSettings(false)
    },
    [globalConfig, setIsShowingSettings, aitoUrl],
  )

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
        isAuthenticationError={isAuthenticationError}
        onDoneClick={onSaveSettings}
      />
    )
  }

  if (currentUpload) {
    const table = base.getTableByIdIfExists(currentUpload.tableId)
    const view = table?.getViewByIdIfExists(currentUpload.viewId)
    if (table && view) {
      return (
        <UploadProgressView
          table={table}
          view={view}
          error={uploadError}
          tasks={currentUpload.tasks}
          onComplete={dismissUploadView}
          client={client}
        />
      )
    }
  }

  // table can be null if it's a new table being created and activeViewId can be null while the
  // table is loading, so we use "ifExists" to allow for these situations.
  const table = cursor.activeTableId ? base.getTableByIdIfExists(cursor.activeTableId) : null

  if (table) {
    const tableConfig = tablesConfig && asTableConfig(tablesConfig[table.id])
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

    const defaultTableConfig: TableConfig = {
      columns: {},
      airtableViewId: viewId,
      lastRowCount: undefined,
      lastUpdated: undefined,
      lastUpdatedBy: undefined,
      lastUpdateStatus: undefined,
      links: undefined,
      views: undefined,
      aitoTableName: `airtable_${table.id}`,
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
        tab={tab}
        setTab={setTab}
      />
    )
  } else {
    // Still loading table and/or view.
    return null
  }
}

export default AitoUploaderApp
