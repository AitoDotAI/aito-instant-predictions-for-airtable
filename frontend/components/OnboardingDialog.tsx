import GlobalConfig from '@airtable/blocks/dist/types/src/global_config'
import {
  Box,
  Button,
  Heading,
  Input,
  Text,
  useViewport,
  useWatchable,
  ViewportConstraint,
  Link,
  Loader,
} from '@airtable/blocks/ui'
import React, { ChangeEvent, useState } from 'react'
import { useCallback } from 'react'
import { areValidCredentials } from '../credentials'
import StatusMessage from './StatusMessage'
import { AITO_KEY, AITO_TABLE_NAME, AITO_URL, HAS_SETUP_ONCE, TABLE_SETTINGS, USER_SETTINGS } from '../GlobalConfigKeys'
import Footer from './Footer'
import AitoLogo from './AitoLogo'

const OnboardingDialog: React.FC<{
  globalConfig: GlobalConfig
}> = ({ globalConfig }) => {
  const viewport = useViewport()

  useWatchable(viewport, 'isFullscreen')

  const canSetup = globalConfig.hasPermissionToSetPaths([
    { path: [HAS_SETUP_ONCE] },
    { path: [TABLE_SETTINGS] },
    { path: [USER_SETTINGS] },
    { path: [AITO_TABLE_NAME] },
    { path: [AITO_URL] },
    { path: [AITO_KEY] },
  ])

  const openDialog = useCallback(() => {
    viewport.enterFullscreenIfPossible()
  }, [viewport])

  type CredentialsState = 'valid' | 'invalid'
  const [credentialsState, setCredentialsState] = useState<CredentialsState>('valid')

  const [aitoUrl, setAitoUrl] = useState('')
  const [aitoKey, setAitoKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Cache callbacks to save re-renders
  type InputEvent = ChangeEvent<HTMLInputElement>
  const onAitoUrlChange = useCallback((e: InputEvent) => setAitoUrl(e.target.value), [setAitoUrl])
  const onAitoKeyChange = useCallback((e: InputEvent) => setAitoKey(e.target.value), [setAitoKey])

  const canSave = aitoUrl.length > 0 && aitoKey.length > 0 && !isSaving
  const save = useCallback(async () => {
    if (isSaving) {
      return
    }
    try {
      setIsSaving(true)
      setCredentialsState('valid')

      const isValid = await areValidCredentials(aitoUrl, aitoKey)

      if (isValid) {
        // Setting these configs re-renders the parent component and takes us from
        // the onboarding view to the normal view
        await globalConfig.setPathsAsync([
          { path: [HAS_SETUP_ONCE], value: true },
          { path: [AITO_URL], value: aitoUrl },
          { path: [AITO_KEY], value: aitoKey },
        ])
        setIsSaving(false)
        viewport.exitFullscreen()
      } else {
        setCredentialsState('invalid')
        setIsSaving(false)
      }
    } catch (e) {
      setCredentialsState('invalid')
      setIsSaving(false)
    }
  }, [isSaving, setIsSaving, aitoUrl, aitoKey, globalConfig, viewport])

  if (!canSetup) {
    return <>Somebody who has permissions needs to setup the application first</>
  } else if (viewport.isFullscreen) {
    // Render popup
    return (
      <ViewportConstraint maxFullscreenSize={{ width: 600 }}>
        <Box display="flex" flexDirection="column">
          <Box flexGrow={0} flexShrink={0} backgroundColor="rgb(0, 69, 72)" padding={3}>
            <AitoLogo />
          </Box>
          <Box flexGrow={1} flexShrink={0}>
            <Box padding={3}>
              <Heading size="xlarge">Welcome to Aito Instant Predictions</Heading>
              <Text variant="paragraph" textColor="light" size="large">
                This app can predict a value for a cell in your table, using the existing data as training material for
                machine learning. No data science skill required. First, we need to set a few things up.
              </Text>
              <Box as="ol" marginRight={3} paddingLeft={3}>
                <li>
                  <h4>Create an Aito account</h4>
                  <p>
                    Sign up to Aito Console, or use your existing account to log in{' '}
                    <Link href="https://console.aito.ai/account/authentication" target="_blank">
                      here
                    </Link>
                    .
                  </p>
                </li>
                <li>
                  <h4>Create an Aito cloud ML instance</h4>
                  <p>
                    In the Aito Console,{' '}
                    <Link href="https://console.aito.ai/instances/create" target="_blank">
                      create a new instance
                    </Link>
                    . Free sandboxes are available - no credit card needed. You can, of course, also use an existing
                    instance.
                  </p>
                </li>
                <li>
                  <h4>Insert your API URL</h4>
                  <p>
                    Find your Aito instance&apos;s API URL from the Overview page in Aito console, and copy the full URL
                    below.
                  </p>
                  <Input value={aitoUrl} onChange={onAitoUrlChange} />
                </li>
                <li>
                  <h4>Insert your Aito API KEY</h4>
                  <p>
                    Provide the <strong>read-write</strong> API key. You can find it in the Aito Console in the Overview
                    page of your instance - below the API URL.{' '}
                    <i>Please note that any collaborator in the base will be able to see this.</i>
                  </p>
                  <Input value={aitoKey} type="password" onChange={onAitoKeyChange} />
                </li>
              </Box>
              <Box marginX={3} marginTop={3} display="flex" alignItems="center">
                <Button marginRight={2} disabled={!canSave} onClick={save} variant="primary">
                  Save
                </Button>
                <Box
                  display="inline-block"
                  style={{
                    visibility: isSaving ? 'visible' : 'hidden',
                    opacity: isSaving ? 1 : 0,
                    transition: 'opacity 1s',
                    verticalAlign: 'center',
                  }}
                >
                  <Loader scale={0.3} />
                </Box>
              </Box>
              <Box marginX={3}>
                <StatusMessage message={isSaving ? 'loading' : credentialsState} my={[3]}>
                  <Text data-message="invalid" variant="paragraph">
                    Unable to validate credentials. Please check that the instance URL and API key are correct.
                  </Text>
                </StatusMessage>
              </Box>
              <Box margin={3}>
                <Footer />
              </Box>
            </Box>
          </Box>
        </Box>
      </ViewportConstraint>
    )
  } else {
    // Render in app box
    return (
      <Box display="flex" height="100vh" flexDirection="column" alignItems="center" justifyContent="center">
        <Button onClick={openDialog}>Click here to setup Aito.ai</Button>
      </Box>
    )
  }
}

export default OnboardingDialog
