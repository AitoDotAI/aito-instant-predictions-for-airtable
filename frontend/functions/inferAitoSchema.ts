import _ from 'lodash'
import { Field } from '@airtable/blocks/models'

import AcceptedFields, { isAcceptedField, isDataField } from '../AcceptedFields'
import { isColumnSchema, ColumnSchema, TableSchema, isTableSchema } from '../schema/aito'
import { TableColumnMap } from '../schema/config'

function fieldToColumnSchema(field: Field): ColumnSchema {
  const conversion = AcceptedFields[field.type]
  if (!conversion) {
    throw new Error('Unknown field type')
  }
  const aitoType = conversion.toAitoType(field.config)
  const analyzer = conversion.toAitoAnalyzer(field.config)

  return isColumnSchema.validate({
    type: aitoType,
    nullable: true,
    analyzer,
  })
}

export const mapColumnNames = (fields: Field[]): TableColumnMap =>
  fields.reduce((mapping, field) => {
    return {
      ...mapping,
      [field.id]: {
        name: field.id,
        type: field.type,
      },
    }
  }, {})

// Aito schema creation
export default function inferAitoSchema(fields: Field[], fieldIdToName: TableColumnMap): TableSchema {
  const fieldsToUse = fields.filter((fld) => isDataField(fld))

  if (_.size(fieldsToUse) <= 0) {
    throw new Error(`Cannot infer schema. No usable fields provided`)
  }

  const invalidFields = fieldsToUse.filter((fld) => !isAcceptedField(fld))
  if (_.size(invalidFields) > 0) {
    throw new Error(
      `The table contains unsupported fields: ${invalidFields.map((f) => `${f.name}/${f.type}`).join(', ')}`,
    )
  }

  const columns = fieldsToUse.map((field) => ({
    [fieldIdToName[field.id].name]: fieldToColumnSchema(field),
  }))

  return isTableSchema.validate({
    type: 'table',
    columns: Object.assign(
      {
        id: { type: 'String', nullable: false },
      },
      ...columns,
    ),
  })
}
