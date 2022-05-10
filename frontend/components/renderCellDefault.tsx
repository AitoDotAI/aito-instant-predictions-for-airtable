import { Field, FieldType } from '@airtable/blocks/models'
import { Box } from '@airtable/blocks/ui'
import React from 'react'
import AcceptedFields from '../AcceptedFields'

const renderCellDefault = (field: Field) => {
  const RenderCell = (cellValue: unknown): React.ReactElement => {
    if (field.type === FieldType.SINGLE_COLLABORATOR || field.type === FieldType.MULTIPLE_COLLABORATORS) {
      return (
        <Box marginLeft={2}>
          <i>Unknown collaborator</i>
        </Box>
      )
    }
    if (field.type === FieldType.MULTIPLE_RECORD_LINKS) {
      return (
        <Box marginLeft={2}>
          <i>Unknown record</i>
        </Box>
      )
    }
    let value: string = String(cellValue)
    try {
      const af = AcceptedFields[field.type]
      if (af) {
        value = af.cellValueToText(cellValue, field.config)
      }
    } catch {
      // Ignore
    }
    return <i>{value}</i>
  }
  return RenderCell
}

export default renderCellDefault
