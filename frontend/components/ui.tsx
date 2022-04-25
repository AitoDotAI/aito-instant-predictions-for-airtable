import { colors, colorUtils, FieldIcon, Icon, Link, loadCSSFromString } from '@airtable/blocks/ui'
import React from 'react'

try {
  loadCSSFromString(`
.aito-inline-icon {
  vertical-align: text-bottom;
}

.aito-ui {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
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

export const InlineLink: React.FC<React.ComponentProps<typeof Link>> = (props) => (
  <Link {...props} className={`aito-inline-icon${(props.className && ' ' + props.className) || ''}`} />
)

export const GRAY_BORDER = colorUtils.getHexForColor(colors.GRAY_LIGHT_1)
export const GRAY_BACKGROUND = colorUtils.getHexForColor(colors.GRAY_LIGHT_2)

export const BORDER_STYLE = `thin solid ${GRAY_BORDER}`
