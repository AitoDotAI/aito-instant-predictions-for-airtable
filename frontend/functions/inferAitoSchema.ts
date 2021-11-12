import _ from 'lodash'
import { Field } from '@airtable/blocks/models'

import AcceptedFields, { isAcceptedField } from '../AcceptedFields'
import { isColumnSchema, ColumnSchema, TableSchema, isTableSchema } from '../schema/aito'
import { TableColumnMap } from '../schema/config'

function fieldToColumnSchema(field: Field): ColumnSchema {
  const conversion = AcceptedFields[field.type]
  if (!conversion) {
    throw new Error('Unknown field type')
  }
  const aitoType = conversion.toAitoType(field)
  const analyzer = conversion.toAitoAnalyzer()

  return isColumnSchema.validate({
    type: aitoType,
    nullable: true,
    analyzer,
  })
}

const sanitizeName = (name: string): string => name.trim().replace(/[\s/".$]/g, '_')

export const mapColumnNames = (fields: Field[]): TableColumnMap =>
  fields.reduce((mapping, field) => {
    return {
      ...mapping,
      [field.id]: {
        name: sanitizeName(field.name),
        type: field.type,
      },
    }
  }, {})

// Aito schema creation
export default function inferAitoSchema(fields: Field[], fieldIdToName: TableColumnMap): TableSchema {
  if (_.size(fields) <= 0) {
    throw new Error(`Cannot infer schema. No fields provided`)
  }

  const invalidFields = fields.filter((fld) => !isAcceptedField(fld))
  if (_.size(invalidFields) > 0) {
    throw new Error(
      `The table contains unsupported fields: ${invalidFields.map((f) => `${f.name}/${f.type}`).join(', ')}`,
    )
  }

  const columns = fields.map((field) => ({
    [fieldIdToName[field.id].name]: fieldToColumnSchema(field),
  }))

  return isTableSchema.validate({
    type: 'table',
    columns: Object.assign({}, ...columns),
  })
}
