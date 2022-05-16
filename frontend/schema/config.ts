import {
  isAny,
  isArrayOf,
  isBoolean,
  isLiteral,
  isMapOf,
  isNumber,
  isObjectOf,
  isSomeOf,
  isString,
  isUndefined,
  ValidatedType,
  Validator,
} from '../validator/validation'

import {
  AITO_TABLE_NAME,
  AIRTABLE_VIEW_ID,
  LAST_UPDATED,
  LAST_UPDATED_BY,
  LAST_ROW_COUNT,
  LAST_UPDATE_STATUS,
  PER_TABLE_SETTINGS as USER_TABLE_SETTINGS,
  AUTO_FILL,
  TABLE_COLUMN_MAP,
  CONFIDENCE_THRESHOLD,
  TABLE_LINKS,
  TABLE_VIEWS,
  AIRTABLE_TABLE_ID,
  TABLE_CLUSTERS,
} from '../GlobalConfigKeys'
import { ClusterParameters } from '../functions/uploadView'

const isCollaborator = isObjectOf({
  id: isString,
  name: isSomeOf(isString, isUndefined),
})

const isTableColumnMapEntry = isObjectOf({
  type: isString, // Airtable type
  name: isString, // Column name in aito
})

const isUpdateStatus = isLiteral('updating', 'failed')

const isTableColumnMap = isMapOf(isTableColumnMapEntry)
export type TableColumnMap = ValidatedType<typeof isTableColumnMap>

export const isLinkViewConfig = isObjectOf({
  [AITO_TABLE_NAME]: isString,
  [AIRTABLE_TABLE_ID]: isString,
  [AIRTABLE_VIEW_ID]: isString,
  [LAST_ROW_COUNT]: isNumber,
  [TABLE_COLUMN_MAP]: isTableColumnMap,
})
export type LinkViewConfig = ValidatedType<typeof isLinkViewConfig>

export const isLinkFieldConfig = isLinkViewConfig
export type LinkFieldConfig = LinkViewConfig

export const isTableConfig = isObjectOf({
  [AITO_TABLE_NAME]: isString,
  [AIRTABLE_VIEW_ID]: isSomeOf(isString, isUndefined),
  [LAST_ROW_COUNT]: isSomeOf(isNumber, isUndefined),
  [LAST_UPDATED]: isSomeOf(isString, isUndefined),
  [LAST_UPDATED_BY]: isSomeOf(isCollaborator, isUndefined),
  [LAST_UPDATE_STATUS]: isSomeOf(isUpdateStatus, isUndefined),
  [TABLE_COLUMN_MAP]: isTableColumnMap,
  [TABLE_LINKS]: isSomeOf(isMapOf(isLinkFieldConfig), isUndefined),
  [TABLE_VIEWS]: isSomeOf(isArrayOf(isLinkViewConfig), isUndefined),
  [TABLE_CLUSTERS]: isSomeOf(isAny, isUndefined),
})
export type TableConfig = ValidatedType<typeof isTableConfig>

export const isTablesConfig = isMapOf(isTableConfig)
export type TablesConfig = ValidatedType<typeof isTablesConfig>

export const isUserTableConfig = isObjectOf({
  [AUTO_FILL]: isSomeOf(isBoolean, isUndefined),
  [CONFIDENCE_THRESHOLD]: isSomeOf(isNumber, isUndefined),
})

export const isUserConfig = isObjectOf({
  [USER_TABLE_SETTINGS]: isMapOf(isUserTableConfig),
})
export type UserConfig = ValidatedType<typeof isUserConfig>

export const isUsersConfig = isMapOf(isUserConfig)
export type UsersConfig = ValidatedType<typeof isUsersConfig>
