import { Field, FieldType, Record } from '@airtable/blocks/models'
import _ from 'lodash'
import { formatISO9075, parse } from 'date-fns'

import { isArrayOf, isNumber, isObjectOf, isString } from './validator/validation'
import { AitoType, Analyzer } from './schema/aito'

const isBoolean = (u: unknown): boolean => {
  return typeof u === 'boolean' || (typeof u === 'string' && ['true', 'false'].includes(_.toLower(u))) || u === null
}

const toBoolean = (u: unknown): boolean => {
  if (u === null) return false
  else if (typeof u === 'boolean') return u
  else if (typeof u === 'string' && _.toLower(u) === 'true') return true
  else {
    // error or just false?
    return false
  }
}
interface SupportedField {
  toAitoValue: (f: Field, r: Record) => string | boolean | number | null
  isValid: (f: Field, r: Record) => boolean
  toAitoType: (f: Field) => AitoType
  toAitoAnalyzer: () => Analyzer | undefined
  toCellValue: (value: unknown) => unknown
  toAitoQuery: (f: Field, value: unknown) => unknown
  hasFeature: (cell: unknown, feature: unknown) => boolean
}

const textConversion: (analyzer: Analyzer) => SupportedField = (analyzer) => ({
  toAitoValue: (f, r) => r.getCellValueAsString(f),
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => analyzer,
  isValid: () => true,
  toCellValue: (v) => String(v),
  toAitoQuery: (_f, v) => v,
  hasFeature: (): boolean => false,
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
const stringConversion: (convert?: (string: string) => string) => SupportedField = (convert = _.identity) => ({
  toAitoValue: (f, r) => convert(r.getCellValueAsString(f)),
  toAitoType: () => 'String',
  isValid: () => true,
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => String(v),
  toAitoQuery: (_f, v) => v,
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
})

const isNumberOptions = isObjectOf({
  precision: isNumber,
})

/**
 *  Numeric field conversion.
 *
 * The convert-method can be used to implement conversions into numeric values. Possible applications
 * include date -> epoch conversion.
 *
 * @param t the type of number. Accepted types are Decimal and Int
 * @param convert convert the string-valued field to a number-format
 * @returns
 */
const numberConversion: (t: 'Decimal' | 'Int', convert?: (string: string) => number) => SupportedField = (
  t,
  convert = (s) => Number(s),
) => ({
  toAitoType: () => t,
  toAitoValue: (f, r) => {
    const convertedValue = convert(r.getCellValueAsString(f))

    if (t === 'Int') return Number(convertedValue?.toFixed())
    else return convertedValue
  },
  isValid: (f, r) => {
    const convertedValue = convert(r.getCellValueAsString(f))

    if (t === 'Int') return Number.isInteger(convertedValue)
    else return !Number.isNaN(convertedValue)
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  toAitoQuery: (f, v) => {
    if (f.type === FieldType.NUMBER && isNumberOptions(f.options)) {
      if (f.options.precision > 0) {
        return { $numeric: v }
      }
    }
    return v
  },
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
})

const currency: SupportedField = {
  toAitoType: () => 'Decimal',
  toAitoValue: (f, r) => {
    return Number(r.getCellValue(f))
  },
  isValid: (f, r) => {
    const convertedValue = Number(r.getCellValue(f))
    return !Number.isNaN(convertedValue)
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  toAitoQuery: (_f, v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
}

const percent: SupportedField = {
  toAitoType: () => 'Decimal',
  toAitoValue: (f, r) => {
    return Number(r.getCellValue(f))
  },
  isValid: (f, r) => {
    const convertedValue = Number(r.getCellValue(f))
    return !Number.isNaN(convertedValue)
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  toAitoQuery: (_f, v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
}

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
  toAitoValue: (f, r) => {
    const cellValue = r.getCellValue(f) as string | null
    if (typeof cellValue === 'string' && cellValue.length > 0) {
      return dateToEpochSeconds(fromString(cellValue))
    } else {
      return null
    }
  },
  isValid: (f, r) => {
    const v = r.getCellValue(f)
    if (v === null) {
      return true
    } else if (isString(v)) {
      try {
        fromString(v)
        return true
      } catch (err) {
        /* no problem */
      }
    }
    return false
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => toString(epochSecondsToDate(Number(v))),
  toAitoQuery: (_f, v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
})

const timeConversion: (convert?: (s: string) => number) => SupportedField = (
  t,
  convert = (s: string) => Number(s),
) => ({
  toAitoType: () => 'Decimal',
  toAitoValue: (f, r) => {
    const isoValue = r.getCellValue(f) as string
    return convert(isoValue)
  },
  isValid: (f, r) => {
    const v = r.getCellValue(f) as string
    if (v === null) {
      return true
    }
    return !Number.isNaN(convert(v))
  },
  toAitoAnalyzer: () => undefined,
  toCellValue: (v) => Number(v),
  toAitoQuery: (f_, v) => ({ $numeric: v }),
  hasFeature: (cell: unknown, feature: unknown): boolean => cell === feature,
})

const hasName = isObjectOf({
  name: isString,
})

const hasId = isObjectOf({
  id: isString,
})

const singleSelect: SupportedField = {
  toAitoValue: (f, r) => {
    const value = r.getCellValue(f)
    if (hasName(value)) {
      return value.name
    } else {
      return null
    }
  },
  toAitoType: () => 'String',
  isValid: () => true,
  toAitoAnalyzer: () => undefined,
  toCellValue: (name) => ({ name }),
  toAitoQuery: (_f, v) => v,
  hasFeature: (cell: unknown, feature: unknown): boolean =>
    hasName(cell) && hasName(feature) && cell.name === feature.name,
}

const isMultipleNames = isArrayOf(hasName)
const delimiter = '\x1f' // ASCII Unit separator

const multipleSelects: SupportedField = {
  toAitoValue: (f, r) => {
    const values = r.getCellValue(f)
    if (isMultipleNames(values)) {
      return values.map(({ name }) => name).join(delimiter)
    } else {
      return null
    }
  },
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => ({ type: 'delimiter', delimiter, trimWhitespace: true }),
  isValid: () => true,
  toCellValue: (v) =>
    v
      ? String(v)
          .split(delimiter)
          .map((name) => ({ name }))
      : [],
  toAitoQuery: (_f, v) => v,
  hasFeature: (cell: unknown, feature: unknown) =>
    isMultipleNames(cell) && isMultipleNames(feature) && Boolean(cell.find((c) => c.name === feature[0]?.name)),
}

const singleCollaborator: SupportedField = {
  toAitoValue: (f, r) => {
    const value = r.getCellValue(f)
    if (hasId(value)) {
      return value.id
    } else {
      return null
    }
  },
  toAitoType: () => 'String',
  isValid: () => true,
  toAitoAnalyzer: () => undefined,
  toCellValue: (id) => ({ id }),
  toAitoQuery: (_f, v) => v,
  hasFeature: (cell: unknown, feature: unknown) => hasId(cell) && hasId(feature) && cell.id === feature.id,
}

const isMultipleIds = isArrayOf(hasId)

const multipleCollaborators: SupportedField = {
  toAitoValue: (f, r) => {
    const values = r.getCellValue(f)
    if (isMultipleIds(values)) {
      return values.map(({ id }) => id).join(delimiter)
    } else {
      return null
    }
  },
  toAitoType: () => 'Text',
  toAitoAnalyzer: () => ({ type: 'delimiter', delimiter, trimWhitespace: true }),
  isValid: () => true,
  toCellValue: (v) =>
    v
      ? String(v)
          .split(delimiter)
          .map((id) => ({ id }))
      : [],
  toAitoQuery: (_f, v) => v,
  hasFeature: (cell: unknown, feature: unknown) =>
    isMultipleIds(cell) && isMultipleIds(feature) && Boolean(cell.find((c) => c.id === feature[0]?.id)),
}

const DateFormat = 'yyyy-MM-dd'

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

NOT SUPPORTED IN MVP:
- Date                      -> int (convert to unix time)
- Created time              -> int (convert to unix time)
- Last modified time        -> int (convert to unix time)
- Duration                  -> int

NOT SUPPORTED (automatically ignored in the upload)
- Link to another record
- Attachment
- Formula
- Rollup
- Lookup
- Barcode
- Button
- Count
*/
const AcceptedFields: Partial<globalThis.Record<FieldType, SupportedField>> = {
  /**
   * Boolean fields
   */
  [FieldType.CHECKBOX]: {
    toAitoType: () => 'Boolean',
    toAitoValue: (f, r) => toBoolean(r.getCellValue(f)),
    isValid: (f, r) => isBoolean(r.getCellValue(f)),
    toAitoAnalyzer: () => undefined,
    toCellValue: (v) => v,
    toAitoQuery: (_f, v) => v,
    hasFeature: (cell, feature) => Boolean(cell) === Boolean(feature),
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

  [FieldType.SINGLE_SELECT]: singleSelect,
  [FieldType.MULTIPLE_SELECTS]: multipleSelects,

  /**
   * Numeric fields
   */
  [FieldType.AUTO_NUMBER]: numberConversion('Int'),
  [FieldType.RATING]: numberConversion('Int'),
  [FieldType.NUMBER]: numberConversion('Decimal'),
  [FieldType.CURRENCY]: currency,
  [FieldType.PERCENT]: percent,

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
}

export const isAcceptedField = (field: Field): boolean => field.type in AcceptedFields

export default AcceptedFields
