import _ from 'lodash'
import React, { useContext } from 'react'
import { isUserConfig, UserConfig } from './schema/config'

const KEY = 'localConfig'

type GetterAndSetter = readonly [UserConfig, (newConfig: UserConfig) => void]

const EmptyUserConfig: UserConfig = { tables: {} }
const DoNothing = () => {}

export const LocalConfig = React.createContext<GetterAndSetter>([EmptyUserConfig, DoNothing])

export const useLocalConfig = (): GetterAndSetter => useContext(LocalConfig)

export const readLocalConfig = (): UserConfig => {
  const json = localStorage.getItem(KEY)
  try {
    if (json) {
      const localState = JSON.parse(json)
      if (isUserConfig(localState)) {
        return localState
      }
    }
  } catch (e) {
    /* no problem */
  }
  return { tables: {} }
}

export const writeLocalConfig = _.debounce((config: UserConfig): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch (e) {
    console.error(e)
  }
}, 100)
