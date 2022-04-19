import { colors, colorUtils, FieldIcon, Icon, loadCSSFromString } from '@airtable/blocks/ui'
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

export const GRAY_BORDER = colorUtils.getHexForColor(colors.GRAY_LIGHT_1)
export const GRAY_BACKGROUND = colorUtils.getHexForColor(colors.GRAY_LIGHT_2)

export const BORDER_STYLE = `thin solid ${GRAY_BORDER}`
