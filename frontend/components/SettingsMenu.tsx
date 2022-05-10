import {
  Box,
  Text,
  Button,
  FormField,
  Heading,
  Input,
  useGlobalConfig,
  Loader,
  Link,
  ConfirmationDialog,
} from '@airtable/blocks/ui'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import _ from 'lodash'
import { areValidCredentials, normalizeAitoUrl } from '../credentials'
import StatusMessage from './StatusMessage'
import Footer from './Footer'

type GlobalConfig = ReturnType<typeof useGlobalConfig>

const FACTORY_RESET_SEQUENCE = 'Please reset my aito settings'

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
  isAuthenticationError: boolean
  onDoneClick: (settings: Settings) => void
  onCloseClick: () => unknown
  onClearSettings: () => unknown
}> = (props) => {
  const { canUpdateSettings, settings, onDoneClick, onCloseClick, onClearSettings, isAuthenticationError } = props

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

  interface FactoryResetState {
    eventListener?: any
    offset: number
  }

  const factoryReset = useRef<FactoryResetState>({ offset: 0 })

  const [showResetDialog, setShowResetDialog] = useState(false)

  useEffect(() => {
    const state = factoryReset.current
    if (state.eventListener) {
      document.body.removeEventListener('keypress', state.eventListener)
    }
    state.eventListener = (e: KeyboardEvent) => {
      const expected = FACTORY_RESET_SEQUENCE[state.offset]
      if (e.key === expected) {
        state.offset++
        if (state.offset === FACTORY_RESET_SEQUENCE.length) {
          setShowResetDialog(true)
          state.offset = 0
        }
      } else {
        state.offset = e.key === FACTORY_RESET_SEQUENCE[0] ? 1 : 0
      }
    }
    document.body.addEventListener('keypress', state.eventListener)

    return () => {
      document.body.removeEventListener('keypress', state.eventListener)
    }
  }, [setShowResetDialog])

  return (
    <Box display="flex" flexDirection="column" height="100vh">
      {showResetDialog && (
        <ConfirmationDialog
          onCancel={() => setShowResetDialog(false)}
          onConfirm={() => (onClearSettings(), setShowResetDialog(false))}
          body="Do you want to clear local settings"
          title="Clear settings"
          confirmButtonText="Clear"
        />
      )}

      {isAuthenticationError && (
        <Box backgroundColor="#f82b60" borderColor="#404040" borderWidth="thick" width="100%" padding={3}>
          <Text variant="paragraph" size="large" textColor="white" margin={0} padding={0}>
            Aito instance authorization failed. Please check that they API key and instance URL are both valid.
          </Text>
        </Box>
      )}
      <Box marginX={3} marginBottom={3} marginTop={2} flexGrow={1}>
        <Box display="flex">
          <Heading size="small" flexGrow={1}>
            Settings
          </Heading>
          <Button icon="x" aria-label="close" variant="secondary" onClick={onCloseClick} marginRight={-2} />
        </Box>

        <Text variant="paragraph">
          Login to{' '}
          <Link target="_blank" href="https://console.aito.ai/">
            Aito console
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
      </Box>
      <Box flexGrow={0} padding={3}>
        <Footer />
      </Box>
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
