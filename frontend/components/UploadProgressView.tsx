import { FlexItemSetProps, SpacingSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Table, View } from '@airtable/blocks/models'
import { Box, Button, Icon, Loader, Heading, Text, Link, useBase, useLoadable, ProgressBar } from '@airtable/blocks/ui'
import React from 'react'
import AitoClient, { AitoError } from '../AitoClient'
import {
  CreateLinkTask,
  CreateTableTask,
  TaskStatus,
  UploadLinkTask,
  UploadTableTask,
  UploadTask,
} from '../functions/uploadView'
import QueryQuotaExceeded from './QueryQuotaExceeded'
import StatusMessage from './StatusMessage'

const colorByStatus = (status: TaskStatus): string | undefined => {
  if (status === 'pending') {
    return 'light'
  } else {
    return undefined
  }
}

const StatusIcon: React.FC<
  {
    status: TaskStatus
  } & FlexItemSetProps &
    SpacingSetProps
> = ({ status, ...other }) =>
  status === 'in-progress' ? (
    <Loader scale={0.3} {...other} style={{ verticalAlign: 'text-bottom' }} />
  ) : (
    <Icon
      style={{ verticalAlign: 'text-bottom' }}
      {...other}
      name={status === 'done' ? 'check' : status === 'error' ? 'x' : 'minus'}
      fillColor={status === 'done' ? 'green' : status === 'error' ? 'red' : 'gray'}
    />
  )

const TaskLine: React.FC<{
  status: TaskStatus
  progress?: number | undefined
}> = ({ status, progress, children }) => {
  return (
    <Box display="flex" flexDirection="column">
      <Box display="flex" flexDirection="row">
        <Text flexGrow={0} flexShrink={0} variant="default" marginRight={1}>
          <StatusIcon status={status} />
        </Text>
        <Text textColor={colorByStatus(status)} flexGrow={1} variant="default">
          {children}
        </Text>
      </Box>
      <Box
        marginLeft="16px"
        paddingLeft={2}
        marginBottom={2}
        marginTop={1}
        style={{
          opacity: typeof progress === 'number' && status === 'in-progress' ? 1 : 0,
          transitionProperty: 'opacity',
          transitionDuration: '0.25s',
          transitionTimingFunction: 'ease-out',
        }}
      >
        <ProgressBar progress={progress || 0} />
      </Box>
    </Box>
  )
}

const CreateTableProgress: React.FC<{
  task: CreateTableTask
}> = ({ task }) => {
  const { tableId, viewId } = task
  const base = useBase()

  const table = base.getTableById(tableId)
  const view = table.getViewById(viewId)

  return (
    <TaskLine status={task.status} progress={task.progress}>
      Create Aito table schema using the fields in view <strong>{view.name}</strong> of table{' '}
      <strong>{table.name}</strong>
    </TaskLine>
  )
}

const CreateLinkProgress: React.FC<{
  mainView: View
  task: CreateLinkTask
}> = ({ task, mainView }) => {
  const { tableId, linkFieldId } = task
  const base = useBase()

  const table = base.getTableById(tableId)
  const metadata = mainView.selectMetadata()
  useLoadable(metadata)

  const field = metadata.allFields.find((field) => field.id === linkFieldId)
  if (!field) {
    return null
  }

  return (
    <TaskLine status={task.status} progress={task.progress}>
      Create Aito table schema for link field {field.name} to table <strong>{table.name}</strong>
    </TaskLine>
  )
}

const UploadTableProgress: React.FC<{
  task: UploadTableTask
}> = ({ task }) => {
  const { tableId, viewId } = task
  const base = useBase()

  const table = base.getTableById(tableId)
  const view = table.getViewById(viewId)

  return (
    <TaskLine status={task.status} progress={task.progress}>
      Upload records from <strong>{table.name}</strong> using view <strong>{view.name}</strong>
    </TaskLine>
  )
}

const UploadLinkProgress: React.FC<{
  task: UploadLinkTask
  mainView: View
}> = ({ task, mainView }) => {
  const { linkFieldId } = task

  const metadata = mainView.selectMetadata()
  useLoadable(metadata)

  const field = metadata.allFields.find((field) => field.id === linkFieldId)
  if (!field) {
    return null
  }

  return (
    <TaskLine status={task.status} progress={task.progress}>
      Upload links for field <strong>{field.name}</strong>
    </TaskLine>
  )
}

const Task: React.FC<{
  mainView: View
  task: UploadTask
}> = ({ task, mainView }) => {
  let element: React.ReactElement

  switch (task.type) {
    case 'create-table':
      element = <CreateTableProgress task={task} />
      break

    case 'create-link':
      element = <CreateLinkProgress task={task} mainView={mainView} />
      break

    case 'upload-table':
      element = <UploadTableProgress task={task} />
      break

    case 'upload-link':
      element = <UploadLinkProgress task={task} mainView={mainView} />
      break
  }

  return (
    <React.Suspense
      fallback={
        <Box display="flex" flexDirection="column" justifyContent="center">
          <Loader scale={0.3} alignSelf="center" />
        </Box>
      }
    >
      {element}
    </React.Suspense>
  )
}

const UploadProgressView: React.FC<{
  table: Table
  view: View
  error: AitoError | undefined
  onComplete: () => unknown
  tasks: UploadTask[]
  client: AitoClient
}> = ({ onComplete, client, tasks, view, error }) => {
  type UploadState = 'uploading' | 'done' | 'error'
  const uploadState: UploadState =
    error || tasks.find((task) => task.status === 'error')
      ? 'error'
      : tasks.find((task) => task.status !== 'done')
      ? 'uploading'
      : 'done'

  const hasLinks = Boolean(tasks.find((t) => t.type === 'create-link'))

  return (
    <Box display="flex" flexDirection="column" minHeight="100vh" paddingX={3} paddingTop={2} paddingBottom={3}>
      <Heading size="small">Sync</Heading>
      <Text textColor="light" marginBottom={3}>
        Syncing records{hasLinks && ' and links'} to <strong>{client.name}</strong>. Please keep this window open until
        the upload has finished or the sync may fail.
      </Text>
      {tasks.map((task, i) => (
        <Task task={task} mainView={view} key={i} />
      ))}
      <StatusMessage message={uploadState}>
        <Box data-message="done">
          <Heading size="small">Done</Heading>
          <Text variant="paragraph">
            {/*uploadedRows*/ 0} records have been uploaded to <strong>{client.name}</strong>
          </Text>

          <Text variant="paragraph">
            <strong>Note:</strong> Training data is not automatically synchronized to your Aito.ai instance. If your
            training data changes and you want your predictions to be informed by the updates then you can re-upload the
            new training.
          </Text>

          <Box display="flex" flexDirection="row" flexWrap="wrap">
            <Button onClick={onComplete} marginRight={2}>
              Click here to start predicting
            </Button>
            <Text style={{ whiteSpace: 'nowrap' }} lineHeight="32px">
              <Link href="https://console.aito.ai/" target="_blank">
                or evaluate the accuracy in Aito console
              </Link>
            </Text>
          </Box>
        </Box>
        <Box data-message="error">
          <Heading size="small">Failure</Heading>
          {error === 'quota-exceeded' ? (
            <QueryQuotaExceeded />
          ) : error === 'forbidden' ? (
            <Text variant="paragraph">
              Something was wrong with the Aito instance name or API key. Please review your credentials in the settings
              view.
            </Text>
          ) : (
            <Text variant="paragraph">Failed to upload content!</Text>
          )}
          <Button onClick={onComplete}>Back</Button>
        </Box>
      </StatusMessage>
    </Box>
  )
}

export default UploadProgressView
