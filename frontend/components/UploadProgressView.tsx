import { Table, View } from '@airtable/blocks/models'
import { Box, Button, Loader, Heading, Text, Link, useBase, useLoadable, ProgressBar } from '@airtable/blocks/ui'
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

const TaskLine: React.FC<{
  status: TaskStatus
  progress?: number | undefined
}> = ({ children }) => {
  return (
    <Text textColor="light" size="small" variant="default">
      {children}
    </Text>
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

  const uploadedRecords = tasks.reduce(
    (acc, task) => (task.type === 'upload-table' ? acc + (task.recordCount || 0) : acc),
    0,
  )

  const uploadedLinks = tasks.reduce(
    (acc, task) => (task.type === 'upload-link' ? acc + (task.linkCount || 0) : acc),
    0,
  )

  const totalTasks = tasks.length
  const progressSum = tasks.reduce((acc, task) => acc + (task.status === 'done' ? 1 : task.progress || 0), 0)
  const progress = progressSum / totalTasks
  const currentTask = tasks.find((task) => task.status !== 'done') || tasks[tasks.length - 1]

  return (
    <Box display="flex" flexDirection="column" minHeight="100vh" paddingX={3} paddingTop={2} paddingBottom={3}>
      <StatusMessage message={uploadState}>
        <Box data-message="uploading">
          <Heading size="small">Synchronizing</Heading>
          <Text variant="paragraph">
            Synchronizing records{hasLinks && ' and links'} to <strong>{client.name}</strong>. Please keep this
            extension window open until the upload has finished or the sync may fail.
          </Text>
          <ProgressBar progress={progress} />
          <Task mainView={view} task={currentTask} />
        </Box>
        <Box data-message="done">
          <Heading size="small">Done</Heading>
          <Text variant="paragraph">
            <strong>{client.name}</strong> has been trained with {uploadedRecords} records{' '}
            {uploadedLinks > 0 && <>and {uploadedLinks} links</>}.
          </Text>
          <Text variant="paragraph">
            <strong>Note:</strong> Training data is not automatically synchronized to your Aito.ai instance. When your
            data changes and you want the predictions to reflect the updates, please re-train Aito.
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
            <Text variant="paragraph">Synchronization failed!</Text>
          )}
          <Button onClick={onComplete}>Back</Button>
        </Box>
      </StatusMessage>
    </Box>
  )
}

export default UploadProgressView
