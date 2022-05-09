import { Field, FieldConfig, FieldType } from '@airtable/blocks/models'
import _ from 'lodash'
import { formatISO9075, parse } from 'date-fns'

import {
  Validator,
  isBoolean,
  isArrayOf,
  isNull,
  isNumber,
  isObjectOf,
  isSomeOf,
  isString,
  isUndefined,
} from './validator/validation'
import { AitoType, Analyzer } from './schema/aito'

type AitoValue = string | boolean | number | null

const isAitoValue: Validator<AitoValue> = isSomeOf(isString, isNumber, isBoolean, isNull)

interface SupportedField {
  isMultipleSelect?: boolean

  toAitoValue: (value: unknown, config: FieldConfig) => AitoValue
  toAitoType: (config: FieldConfig) => AitoType
  toAitoAnalyzer: (config: FieldConfig) => Analyzer | undefined
  toCellValue: (value: unknown, config: FieldConfig) => unknown
  cellValueToText: (value: unknown, config: FieldConfig) => string
  toAitoQuery: (value: AitoValue, config: FieldConfig) => unknown
  hasFeature: (cell: unknown, feature: unknown, config: FieldConfig) => boolean

  /** add `feature` to `cell` and return combination */
  addFeature: (cell: unknown, feature: unknown, config: FieldConfig) => unknown

  /** remove `feature` from `cell` and return the new cell value */
  removeFeature: (cell: unknown, feature: unknown, config: FieldConfig) => unknown
}

const textConversion = (analyzer: Analyzer): SupportedField => ({
  isMultipleSelect: true,
  toAitoValue: (value) => (isAitoValue(value) ? value : null),
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => analyzer,
  toCellValue: (v) => String(v),
  cellValueToText: (v) => String(v),
  toAitoQuery: (v) => v,
  hasFeature: (): boolean => false,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
})

/**
 * String-field, with optional conversion.
 *
 * Conversions could be used to, say, remove whitespace, add a prefix, ... before getting the
 * value to upload to Aito.
 *
 * @param convert takes a string, returns a string.
 * @returns
 */
const stringConversion = (convert: (string: string) => string = _.identity): SupportedField => ({
  toAitoValue: (v) => (isString(v) ? convert(v) : null),
  toAitoType: () => 'String',
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => String(v),
  cellValueToText: (v) => String(v),
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
})

const isBarcodeCell = isObjectOf({
  text: isString,
  type: isSomeOf(isString, isUndefined),
})

/**
 * Barcode-field
 *
 * Barcode values are represented in cells as BarcodeCell, e.g.
 * { type: "ean8", text: "12345678" }. In aito we store it as
 * string
 */
const barcode: SupportedField = {
  toAitoValue: (value) => {
    if (isBarcodeCell(value)) {
      return JSON.stringify({ type: value.type, text: value.text })
    }
    return null
  },
  toAitoType: () => 'String',
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => {
    try {
      return JSON.parse(String(v))
    } catch (e) {
      console.error('Invalid barcode:', v, e)
      return null
    }
  },
  cellValueToText: (v) => {
    if (isBarcodeCell(v)) {
      return v.text
    } else {
      return String(v)
    }
  },
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature, // ???
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
}

/**
 *  Numeric field conversion.
 *
 * The convert-method can be used to implement conversions into numeric values.
 *
 * @param t the type of number. Accepted types are Decimal and Int
 * @param convert convert the string-valued field to a number-format
 * @returns
 */
const numberConversion = (t: 'Decimal' | 'Int', alwaysNumeric: boolean = false): SupportedField => ({
  toAitoType: () => t,
  toAitoValue: (value) => {
    if (typeof value === 'number') {
      const convertedValue = value

      if (t === 'Int') {
        return Number(convertedValue.toFixed())
      }
      return convertedValue
    }
    return null
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  cellValueToText: (v) => String(v),
  toAitoQuery: alwaysNumeric
    ? (v) => ({ $numeric: v })
    : (v, config) => {
        if (
          config.type === FieldType.NUMBER ||
          config.type === FieldType.PERCENT ||
          config.type === FieldType.CURRENCY
        ) {
          if (config.options.precision > 0) {
            return { $numeric: v }
          }
        }
        return v
      },
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
})

/**
 * Millisecond times can't fit into a standard JVM integer-field, so we need to
 * convert to unix epoch, which is in full seconds
 *
 * @param date
 * @returns
 */
function dateToEpochSeconds(date: Date): number {
  return date.getTime() / 1000
}

function epochSecondsToDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000)
}

const referenceDate = new Date('2000-01-01T00:00:00.000Z')

/**
 *  Date field conversion.
 *
 * @param t
 * @param convert
 * @returns
 */
const dateTimeConversion = (fromString: (d: string) => Date, toString: (d: Date) => string): SupportedField => ({
  toAitoType: () => 'Decimal',
  toAitoValue: (cellValue) => {
    if (typeof cellValue === 'string' && cellValue.length > 0) {
      return dateToEpochSeconds(fromString(cellValue))
    } else {
      return null
    }
  },
  cellValueToText: (v) => String(v),
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => toString(epochSecondsToDate(Number(v))),
  toAitoQuery: (v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
})

const timeConversion: (convert?: (s: string) => number) => SupportedField = (
  t,
  convert = (s: string) => Number(s),
) => ({
  toAitoType: () => 'Decimal',
  toAitoValue: (isoValue) => {
    return isoValue === null ? null : convert(isoValue as string)
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  cellValueToText: (v) => String(v),
  toAitoQuery: (v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
})

const hasName = isObjectOf({
  name: isString,
})

const hasId = isObjectOf({
  id: isString,
})

const singleSelect: SupportedField = {
  toAitoValue: (value) => {
    if (hasName(value)) {
      return value.name
    } else {
      return null
    }
  },
  toAitoType: () => 'String',
  toAitoAnalyzer: () => undefined,
  toCellValue: (name) => ({ name }),
  cellValueToText: (v) => {
    const obj = v as any
    if ('name' in obj && obj.name) {
      return String(obj.name)
    } else {
      return String(v)
    }
  },
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown): boolean =>
    hasName(cell) && hasName(feature) && cell.name === feature.name,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
}

const isMultipleNames = isArrayOf(hasName)
const delimiter = '\x1f' // ASCII Unit separator

const multipleSelects: SupportedField = {
  isMultipleSelect: true,

  toAitoValue: (values) => {
    if (isMultipleNames(values)) {
      return values.map(({ name }) => name).join(delimiter)
    } else {
      return null
    }
  },
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => ({ type: 'delimiter', delimiter, trimWhitespace: true }),
  toCellValue: (v) =>
    v
      ? String(v)
          .split(delimiter)
          .map((name) => ({ name }))
      : [],
  cellValueToText: (v) => {
    try {
      return (v as any).map((o: any) => o.name).join(', ')
    } catch (e) {
      return String(v)
    }
  },
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown) =>
    isMultipleNames(cell) && isMultipleNames(feature) && Boolean(cell.find((c) => c.name === feature[0]?.name)),
  addFeature: (cell, feature) =>
    isMultipleNames(cell) && isMultipleNames(feature) && !cell.find(({ name }) => name === feature[0].name)
      ? [...cell, ...feature]
      : cell,
  removeFeature: (cell, feature) =>
    isMultipleNames(cell) && isMultipleNames(feature) ? cell.filter((v) => v.name !== feature[0]?.name) : cell,
}

const singleCollaborator: SupportedField = {
  toAitoValue: (value) => {
    if (hasId(value)) {
      return value.id
    } else {
      return null
    }
  },
  toAitoType: () => 'String',
  toAitoAnalyzer: () => undefined,
  toCellValue: (id) => ({ id }),
  cellValueToText: (v) => {
    try {
      return (v as any).id
    } catch (e) {
      return String(v)
    }
  },
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown) => hasId(cell) && hasId(feature) && cell.id === feature.id,
  addFeature: (cell) => cell,
  removeFeature: (cell) => cell,
}

const isMultipleIds = isArrayOf(hasId)

const multipleCollaborators: SupportedField = {
  isMultipleSelect: true,

  toAitoValue: (values) => {
    if (isMultipleIds(values)) {
      return values.map(({ id }) => id).join(delimiter)
    } else {
      return null
    }
  },
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => ({ type: 'delimiter', delimiter, trimWhitespace: true }),
  toCellValue: (v) =>
    v
      ? String(v)
          .split(delimiter)
          .map((id) => ({ id }))
      : [],
  cellValueToText: (v) => {
    try {
      return (v as any).map((o: any) => o.id).join(', ')
    } catch (e) {
      return String(v)
    }
  },
  toAitoQuery: (v) => v,
  hasFeature: (cell: unknown, feature: unknown) =>
    isMultipleIds(cell) && isMultipleIds(feature) && Boolean(cell.find((c) => c.id === feature[0]?.id)),
  addFeature: (cell, feature) =>
    isMultipleIds(cell) && isMultipleIds(feature) && !cell.find(({ id }) => id === feature[0].id)
      ? [...cell, ...feature]
      : cell,
  removeFeature: (cell, feature) =>
    isMultipleIds(cell) && isMultipleIds(feature) ? cell.filter((v) => v.id !== feature[0]?.id) : cell,
}

const DateFormat = 'yyyy-MM-dd'

type FormulaFieldConfig = FieldConfig & { type: FieldType.FORMULA | FieldType.ROLLUP }

function assertFormulaType(config: FieldConfig): asserts config is FormulaFieldConfig {
  if (config.type !== FieldType.FORMULA && config.type !== FieldType.ROLLUP) {
    throw new Error('Argument is not of the expected type')
  }
}

const getResultFieldType = (config: FormulaFieldConfig): SupportedField | undefined => {
  if (!config.options.isValid) {
    return
  }
  const supportedField = AcceptedFields[config.options.result.type]
  if (!supportedField) {
    throw new Error('Expected formula result type to be supported at this point')
  }
  return supportedField
}

// When a formula field is invalid then use the following type
const FALLBACK_RESULT_TYPE = 'String'

const formulaOrRollup: SupportedField = {
  toAitoValue: (value, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      // formula is invalid
      return null
    }
    return resultFieldType.toAitoValue(value, config)
  },
  toAitoType: (config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    return resultFieldType ? resultFieldType.toAitoType(config.options.result) : FALLBACK_RESULT_TYPE
  },
  toAitoAnalyzer: (config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (resultFieldType) {
      return resultFieldType.toAitoAnalyzer(config.options.result)
    }
  },
  toCellValue: (v, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return null
    }
    return resultFieldType.toCellValue(v, config.options.result)
  },
  cellValueToText: (v, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return String(v)
    }
    return resultFieldType.cellValueToText(v, config.options.result)
  },
  toAitoQuery: (v, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return String(v)
    }
    return resultFieldType.toAitoQuery(v, config.options.result)
  },
  hasFeature: (cell, feature, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return false
    }
    return resultFieldType.hasFeature(cell, feature, config.options.result)
  },
  addFeature: (cell, feature, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return cell
    }
    return resultFieldType.addFeature(cell, feature, config.options.result)
  },
  removeFeature: (cell, feature, config) => {
    assertFormulaType(config)
    const resultFieldType = getResultFieldType(config)
    if (!resultFieldType) {
      return cell
    }
    return resultFieldType.removeFeature(cell, feature, config.options.result)
  },
}

const ignore: SupportedField = {
  cellValueToText: () => '',
  hasFeature: () => false,
  toAitoAnalyzer: () => undefined,
  toAitoQuery: _.identity,
  toAitoType: () => 'String',
  toAitoValue: () => null,
  toCellValue: () => null,
  addFeature: () => null,
  removeFeature: () => null,
}

/**
Airtable to Aito datatype mapping
- Single line text          -> string (getCellValueAsString)
- Long text                 -> text, standard analyzer (getCellValueAsString)
- Checkbox                  -> boolean (getCellValue: true->true, null->false)
- Multiple select           -> text, analyzer "," character separator (getCellValueAsString)
- Single select             -> string (getCellValueAsString)
- Collaborator              -> string (getCellValueAsString)
- Phone number              -> string (getCellValueAsString)
- Email                     -> string (getCellValueAsString)
- URL                       -> string (getCellValueAsString)
- Number                    -> mvp always decimal (getCellValue)
- Currency                  -> decimal (getCellValue)
- Percent                   -> decimal (getCellValue)
- Rating                    -> int (1-10) and null (getCellValue)
- Created by                -> string (getCellValueAsString)
- Last modified by          -> string (getCellValueAsString)
- Autonumber                -> int (getCellValue)
- Date                      -> int (convert to unix time)
- Created time              -> int (convert to unix time)
- Last modified time        -> int (convert to unix time)
- Duration                  -> int
- Formula                   -> depends on the formula
- Barcode                   -> JSON string
- Rollup                    -> depends on the formula
- Count                     -> int
- Attachment                -> delimited list of ids
- External sync source      -> like Multiple select, but read-only
- Link to another record    -> Same as multiple collaborators, and links stored in separate table

NOT SUPPORTED (automatically ignored in the upload)
- Lookup
- Button
*/
const AcceptedFields: globalThis.Record<FieldType, SupportedField> = {
  [FieldType.MULTIPLE_RECORD_LINKS]: multipleCollaborators,

  /**
   * Boolean fields
   */
  [FieldType.CHECKBOX]: {
    toAitoType: () => 'Boolean',
    toAitoValue: (value) => Boolean(value),
    toAitoAnalyzer: () => undefined,
    toCellValue: (v) => v,
    toAitoQuery: (v) => v,
    cellValueToText: (v) => String(v),
    hasFeature: (cell, feature) => Boolean(cell) === Boolean(feature),
    addFeature: (cell) => cell,
    removeFeature: (cell) => cell,
  },
  /**
   * Text fields. All currently use the same conversion
   */
  [FieldType.SINGLE_LINE_TEXT]: stringConversion(),
  [FieldType.MULTILINE_TEXT]: textConversion('standard'),
  [FieldType.RICH_TEXT]: textConversion('standard'),

  [FieldType.PHONE_NUMBER]: stringConversion(),
  [FieldType.EMAIL]: stringConversion(),
  [FieldType.URL]: stringConversion(),

  [FieldType.CREATED_BY]: singleCollaborator,
  [FieldType.LAST_MODIFIED_BY]: singleCollaborator,
  [FieldType.SINGLE_COLLABORATOR]: singleCollaborator,
  [FieldType.MULTIPLE_COLLABORATORS]: multipleCollaborators,

  [FieldType.EXTERNAL_SYNC_SOURCE]: singleCollaborator,

  [FieldType.SINGLE_SELECT]: singleSelect,
  [FieldType.MULTIPLE_SELECTS]: multipleSelects,

  [FieldType.MULTIPLE_ATTACHMENTS]: ignore,

  /**
   * Numeric fields
   */
  [FieldType.AUTO_NUMBER]: numberConversion('Int'),
  [FieldType.COUNT]: numberConversion('Int', true),
  [FieldType.RATING]: numberConversion('Int'),
  [FieldType.NUMBER]: numberConversion('Decimal'),
  [FieldType.CURRENCY]: numberConversion('Decimal', true),
  [FieldType.PERCENT]: numberConversion('Decimal', true),

  [FieldType.DATE]: dateTimeConversion(
    (d) => parse(d, DateFormat, referenceDate),
    (d) => formatISO9075(d, { representation: 'date' }),
  ),
  [FieldType.DATE_TIME]: dateTimeConversion(
    (d) => new Date(d),
    (d) => d.toISOString(),
  ),
  [FieldType.CREATED_TIME]: dateTimeConversion(
    (d) => new Date(d),
    (d) => d.toISOString(),
  ),
  [FieldType.LAST_MODIFIED_TIME]: dateTimeConversion(
    (d) => new Date(d),
    (d) => d.toISOString(),
  ),

  [FieldType.DURATION]: timeConversion(),

  [FieldType.FORMULA]: formulaOrRollup,
  [FieldType.ROLLUP]: formulaOrRollup,

  [FieldType.BARCODE]: barcode,

  [FieldType.MULTIPLE_LOOKUP_VALUES]: ignore,
  [FieldType.BUTTON]: ignore,
}

export const isAcceptedField = (field: Field): boolean => {
  const config = field.config
  if (config.type === FieldType.FORMULA) {
    return !config.options.isValid || config.options.result.type in AcceptedFields
  }
  return config.type in AcceptedFields
}

export const isIgnoredField = (field: Field): boolean => {
  return AcceptedFields[field.type] === ignore
}

export const isDataField = (field: Field): boolean => {
  return !isIgnoredField(field)
}

export default AcceptedFields
