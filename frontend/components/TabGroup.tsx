import { DimensionsSetProps, FlexItemSetProps, SpacingSetProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Box, loadCSSFromString, Text } from '@airtable/blocks/ui'
import React from 'react'
import './ui'

export interface TabOption<K extends string | number | null> {
  key: K
  label: string
}

try {
  loadCSSFromString(`
.aito-tab {
  cursor: default;
  opacity: 0.8;
}

.aito-tab:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.aito-tab-selected, .aito-tab-selected:hover {
  opacity: 1.0;
  background-color: rgba(255, 255, 255, 0.2);
}
`)
} catch (e) {
  console.error(e)
}

export function TabGroup<K extends string | number | null>(
  props: {
    options: TabOption<K>[]
    value: K
    onChange: (newKey: K) => unknown
  } & DimensionsSetProps &
    SpacingSetProps &
    FlexItemSetProps,
): React.ReactElement {
  const { options, value: currentKey, onChange, ...rest } = props
  return (
    <Box display="flex" flexDirection="row" justifyContent="stretch" alignItems="stretch" {...rest}>
      {options.map(({ key, label }) => {
        const isSelected = key === currentKey
        return (
          <Box
            key={key}
            className={`aito-ui aito-tab${isSelected ? ' aito-tab-selected' : ''}`}
            display="flex"
            flexBasis="100%"
            margin={1}
            flexGrow={1}
            alignItems="center"
            justifyContent="center"
            borderRadius={4}
            onClick={() => onChange(key)}
          >
            <Text variant="default" textColor="white" size="default">
              {label}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
