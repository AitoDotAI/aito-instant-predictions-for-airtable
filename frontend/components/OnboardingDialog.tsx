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

const AitoLogo = () => (
  <svg height="2em" viewBox="0 0 613 260">
    <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
      <g id="aito_logo" transform="translate(-7.000000, -7.000000)">
        <g id="Group" transform="translate(7.000000, 7.000000)">
          <path
            d="M600.1104,109.0146 C608.9174,124.3516 613.2144,143.7666 613.0034,163.3896 C613.2144,183.0126 608.9174,202.4266 600.1104,217.7636 C584.8434,244.3506 556.4664,258.8666 527.7744,259.0956 C499.0814,258.8666 470.7054,244.3506 455.4384,217.7636 C446.6314,202.4266 442.3334,183.0126 442.5454,163.3896 C442.3334,143.7666 446.6314,124.3516 455.4384,109.0146 C470.7054,82.4286 499.0814,67.9116 527.7744,67.6826 C556.4664,67.9116 584.8434,82.4286 600.1104,109.0146 Z M482.626,105.375 C484.646,147.517 484.646,182.644 482.626,224.784 C511.704,223.391 540.833,223.391 569.912,224.784 C567.893,182.644 567.893,147.517 569.912,105.375 C540.833,106.768 511.704,106.768 482.626,105.375 Z"
            id="Combined-Shape"
            fill="#00B856"
          ></path>
          <path
            d="M229.2837,0.9043 C218.6317,12.6293 207.4237,23.8373 195.6987,34.4893 C207.4237,45.1423 218.6317,56.3503 229.2837,68.0753 C239.9367,56.3503 251.1447,45.1423 262.8687,34.4893 L262.8697,34.4893 C251.1447,23.8363 239.9367,12.6293 229.2837,0.9043"
            id="Fill-3"
            fill="#FFA9D3"
          ></path>
          <path
            d="M179.5684,216.0508 C179.5684,216.0508 179.8334,243.2248 180.3004,252.9668 L179.5684,252.9668 C160.4234,252.1378 143.2414,243.6478 130.9854,230.5048 C126.0564,237.7318 119.4554,244.0668 111.1234,248.8508 C107.4674,250.9498 103.5894,252.7038 99.5334,254.0688 C92.9244,256.2918 85.9784,257.3418 79.0064,257.3418 L62.7234,257.3418 C55.7514,257.3418 48.8044,256.2918 42.1964,254.0688 C38.1404,252.7038 34.2624,250.9498 30.6064,248.8508 C-10.2026,225.4178 -10.2026,165.1708 30.6064,141.7378 C34.2624,139.6398 38.1404,137.8848 42.1964,136.5208 C48.8044,134.2978 55.7514,133.2478 62.7234,133.2478 L79.0054,133.2478 C85.9784,133.2478 92.9244,134.2978 99.5334,136.5208 C103.5894,137.8848 107.4674,139.6398 111.1234,141.7378 C111.4154,141.9058 114.8424,144.1678 115.1304,144.3398 L115.6814,144.7278 C115.1304,140.7288 115.1304,136.9708 115.1304,133.2478 C115.1374,123.2508 115.3994,113.2548 115.9174,103.2658 L33.2244,107.2588 L33.2234,107.2588 C33.2614,97.5068 33.0754,89.1688 32.6704,79.4278 L32.2294,69.4078 L81.5444,69.4078 C119.0944,71.0338 149.1414,102.0918 149.1414,140.0348 L149.1414,188.2968 C149.1184,198.0488 148.8764,207.7998 148.4094,217.5428 C148.6544,217.5308 179.5684,216.0508 179.5684,216.0508 Z M28.5234,226.2402 C58.8414,224.8082 84.1134,224.8082 114.4314,226.2402 C113.4294,205.6212 113.4294,184.9682 114.4314,164.3482 C84.1134,165.7802 58.8414,165.7802 28.5234,164.3482 C29.5254,184.9682 29.5254,205.6212 28.5234,226.2402 Z"
            id="Combined-Shape"
            fill="#FFA9D3"
          ></path>
          <path
            d="M247.8389,112.0894 C247.8619,102.3414 248.1039,92.5934 248.5709,82.8534 L248.5699,82.8544 L209.9979,82.8534 C210.4639,92.5964 210.7069,102.3474 210.7299,112.0994 L210.7299,223.7594 C210.7069,233.5004 210.4649,243.2394 209.9989,252.9704 L248.5689,252.9704 C248.1029,243.2394 247.8609,233.5004 247.8389,223.7594 L247.8389,112.0894 Z"
            id="Fill-9"
            fill="#FFA9D3"
          ></path>
          <path
            d="M436.9346,120.624 L436.9536,120.624 C436.9476,120.624 436.9406,120.624 436.9346,120.624"
            id="Fill-11"
            fill="#00B856"
          ></path>
          <path
            d="M411.3369,217.5518 L349.6699,220.5068 L349.6669,119.7568 L349.6859,119.7568 C366.9579,120.5838 384.2489,120.9148 401.5349,120.7598 L411.0819,82.8538 L349.6689,82.8538 L349.6689,35.3738 C349.6919,25.6248 349.9349,15.8758 350.4009,6.1348 L350.3999,6.1348 C350.1549,6.1468 349.9139,6.1568 349.6689,6.1688 L329.8029,26.0308 C322.8919,32.9098 308.4039,46.3788 308.4039,46.3788 C308.4039,46.3788 309.1249,66.1468 309.1479,75.8978 L309.1479,82.8538 L278.2679,82.8538 L278.2679,120.7048 C288.4999,120.5598 298.7309,120.2458 308.9549,119.7568 L308.9739,119.7568 L308.9739,183.9598 C308.9739,223.3898 342.7869,257.3528 381.2879,257.3528 L412.8479,257.3528 C412.1829,243.4718 411.7389,230.3838 411.5139,217.5428 L411.3369,217.5518 Z"
            id="Fill-13"
            fill="#00B856"
          ></path>
          <path
            d="M221.688,122.0493 L221.706,122.0493 C221.7,122.0493 221.694,122.0493 221.688,122.0483 L221.688,122.0493 Z"
            id="Fill-15"
            fill="#00B856"
          ></path>
        </g>
      </g>
    </g>
  </svg>
)

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
    return <>Somebody who has permissions needs to setup the extension first</>
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
                This extension can predict a value for a cell in your table, using the existing data as training
                material for machine learning. No data science skill required. First, we need to set a few things up.
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
    // Render in extension box
    return (
      <Box display="flex" height="100vh" flexDirection="column" alignItems="center" justifyContent="center">
        <Button onClick={openDialog}>Click here to setup Aito.ai</Button>
      </Box>
    )
  }
}

export default OnboardingDialog
