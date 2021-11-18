import {
  isBoolean,
  isMapOf,
  isNumber,
  isObjectOf,
  isSomeOf,
  isString,
  isUndefined,
  ValidatedType,
} from '../validator/validation'

import {
  AITO_TABLE_NAME,
  AIRTABLE_VIEW_ID,
  LAST_UPDATED,
  LAST_UPDATED_BY,
  LAST_ROW_COUNT,
  PER_TABLE_SETTINGS as USER_TABLE_SETTINGS,
  AUTO_FILL,
  TABLE_COLUMN_MAP,
} from '../GlobalConfigKeys'

const isCollaborator = isObjectOf({
  id: isString,
  name: isSomeOf(isString, isUndefined),
})

const isTableColumnMapEntry = isObjectOf({
  type: isString, // Airtable type
  name: isString, // Column name in aito
})

const isTableColumnMap = isMapOf(isTableColumnMapEntry)
export type TableColumnMap = ValidatedType<typeof isTableColumnMap>

export const isTableConfig = isObjectOf({
  [AITO_TABLE_NAME]: isString,
  [AIRTABLE_VIEW_ID]: isSomeOf(isString, isUndefined),
  [LAST_ROW_COUNT]: isSomeOf(isNumber, isUndefined),
  [LAST_UPDATED]: isSomeOf(isString, isUndefined),
  [LAST_UPDATED_BY]: isSomeOf(isCollaborator, isUndefined),
  [TABLE_COLUMN_MAP]: isTableColumnMap,
})
export type TableConfig = ValidatedType<typeof isTableConfig>

export const isTablesConfig = isMapOf(isTableConfig)
export type TablesConfig = ValidatedType<typeof isTablesConfig>

export const isUserTableConfig = isObjectOf({
  [AUTO_FILL]: isSomeOf(isBoolean, isUndefined),
})

export const isUserConfig = isObjectOf({
  [USER_TABLE_SETTINGS]: isMapOf(isUserTableConfig),
})
export type UserConfig = ValidatedType<typeof isUserConfig>

export const isUsersConfig = isMapOf(isUserConfig)
export type UsersConfig = ValidatedType<typeof isUsersConfig>
