import { Box } from '@airtable/blocks/ui'
import React from 'react'

// Renders the content in a horizontal row.
export const Row: React.FC<{
  isHeader?: boolean
  highlight?: boolean
}> = ({ children, isHeader = false, highlight }) => {
  return (
    <Box
      display="flex"
      borderTop={isHeader ? 'none' : 'thick'}
      paddingY={2}
      backgroundColor={highlight ? '#f0f7ff' : 'inherit'}
    >
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
      overflowX="hidden"
      style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
    >
      {children}
    </Box>
  )
}
