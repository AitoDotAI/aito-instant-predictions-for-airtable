import { FieldIcon, Icon, loadCSSFromString } from '@airtable/blocks/ui'
import React from 'react'

try {
  loadCSSFromString(`
.aito-inline-icon {
  vertical-align: text-bottom;
}
`)
} catch (e) {
  console.error(e)
}

export const InlineIcon: React.FC<React.ComponentProps<typeof Icon>> = (props) => (
  <Icon className="aito-inline-icon" marginRight={1} {...props} />
)

export const InlineFieldIcon: React.FC<React.ComponentProps<typeof FieldIcon>> = (props) => (
  <FieldIcon className="aito-inline-icon" marginRight={1} {...props} />
)
