import { Box } from '@airtable/blocks/ui'
import React from 'react'

// Renders the content in a horizontal row.
export const Row: React.FC<{
  highlight?: boolean
}> = ({ children, highlight }) => {
  return (
    <Box display="flex" paddingY={1} marginY={1} backgroundColor={highlight ? '#f0f7ff' : 'inherit'}>
      {children}
    </Box>
  )
}

// Renders a table cell with border and children.
export const Cell: React.FC<{
  width?: string
  flexGrow?: number
  flexShrink?: number
}> = ({ children, width = 'auto', flexGrow = 1, flexShrink = 0 }) => {
  return (
    <Box
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      flexBasis={width}
      paddingRight={1}
      overflow="hidden"
      style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
    >
      {children}
    </Box>
  )
}
