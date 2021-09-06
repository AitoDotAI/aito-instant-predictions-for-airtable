import { Box, Text, Button, FormField, Heading, Input, useGlobalConfig, Loader, Link } from '@airtable/blocks/ui'
import React, { useCallback, useState } from 'react'
import styled from 'styled-components'
import _ from 'lodash'
import { areValidCredentials, normalizeAitoUrl } from '../credentials'
import StatusMessage from './StatusMessage'
import Footer from './Footer'

type GlobalConfig = ReturnType<typeof useGlobalConfig>

export interface Settings {
  aitoUrl: string
  aitoKey: string
}

const setAitoUrl = (settings: Settings, newAitoUrl: string): Settings => ({
  ...settings,
  aitoUrl: newAitoUrl,
})

const setAitoKey = (settings: Settings, newAitoKey: string): Settings => ({
  ...settings,
  aitoKey: newAitoKey,
})

const SettingsMenu: React.FC<{
  globalConfig: GlobalConfig
  settings: Settings
  canUpdateSettings: boolean
  onDoneClick: (settings: Settings) => void
}> = (props) => {
  const { canUpdateSettings, settings, onDoneClick } = props

  const [stagedChanges, setStagedChanges] = useState(settings)
  const [isSaving, setIsSaving] = useState(false)

  type CredentialsState = 'valid' | 'invalid'
  const [credentialsState, setCredentialsState] = useState<CredentialsState>('valid')

  const saveChanges = useCallback(async () => {
    if (isSaving) {
      return
    }
    setIsSaving(true)
    try {
      const url = normalizeAitoUrl(stagedChanges.aitoUrl)
      const key = stagedChanges.aitoKey
      let isValid = false
      try {
        isValid = await areValidCredentials(url, key)
      } catch (e) {
        console.error('Failed to validate credentials', e)
      }

      if (!isValid) {
        setCredentialsState('invalid')
      } else {
        onDoneClick(stagedChanges)
      }
    } catch (e) {
      console.error('Failed to save changes', e)
    }
    setIsSaving(false)
  }, [stagedChanges, onDoneClick, isSaving, setIsSaving])

  const normalizedUrl = normalizeAitoUrl(stagedChanges.aitoUrl)
  const hasChanges = !_.isEqual(
    {
      ...settings,
      aitoUrl: normalizeAitoUrl(settings.aitoUrl),
    },
    {
      ...stagedChanges,
      aitoUrl: normalizedUrl,
    },
  )

  return (
    <Box padding={3} minHeight="100vh">
      <Heading marginBottom={1}>Settings</Heading>
      <Text variant="paragraph" textColor="light">
        Credentials to an Aito.ai instance are required for making predictions and uploading training data.
      </Text>

      <Text variant="paragraph" textColor="light">
        Login to Aito Console{' '}
        <Link target="_blank" href="https://console.aito.ai/">
          here
        </Link>{' '}
        to get your API URL and key.
      </Text>

      <FormField label="Aito Instance name or URL:">
        <Input
          value={stagedChanges.aitoUrl}
          readOnly={!canUpdateSettings}
          placeholder="Check it out from Aito Console"
          onChange={(e) => {
            setStagedChanges(setAitoUrl(stagedChanges, e.target.value))
            setCredentialsState('valid')
          }}
        />
        {stagedChanges.aitoUrl !== normalizedUrl && (
          <Text textColor="light" marginTop={1} style={{ lineBreak: 'anywhere' }}>
            Instance URL: {normalizedUrl}
          </Text>
        )}
      </FormField>
      <FormField label="Aito R/W API KEY:">
        <Input
          type="password"
          value={stagedChanges.aitoKey}
          readOnly={!canUpdateSettings}
          onChange={(e) => {
            setStagedChanges(setAitoKey(stagedChanges, e.target.value))
            setCredentialsState('valid')
          }}
          placeholder="Need to be read/write key"
        />
      </FormField>

      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Button
          variant="primary"
          type="submit"
          icon="check"
          marginRight={2}
          disabled={isSaving || !canUpdateSettings || !hasChanges}
          onClick={saveChanges}
        >
          Apply changes
        </Button>

        <Box flexGrow={1}>
          <HiddenElement className={isSaving ? 'visible' : ''}>
            <Loader scale={0.3} />
          </HiddenElement>
        </Box>
      </Box>

      <div>
        <StatusMessage message={credentialsState} my={[3]}>
          <Text data-message="invalid" variant="paragraph">
            Unable to validate credentials. Please check that the instance URL and API key are correct.
          </Text>
        </StatusMessage>
      </div>

      <Footer />
    </Box>
  )
}

const HiddenElement = styled.div`
  display: inline-block;
  visibility: hidden;
  opacity: 0;
  vertical-align: center;

  transition: opacity 1s;

  &.visible {
    visibility: visible;
    opacity: 1;
  }
`

export default SettingsMenu
