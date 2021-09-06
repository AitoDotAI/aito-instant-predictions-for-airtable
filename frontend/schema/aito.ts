import {
  fromLazy,
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

export const isAitoColumnType = isLiteral('String', 'Text', 'Decimal', 'Int', 'Boolean')
export type AitoType = ValidatedType<typeof isAitoColumnType>

const isStandardAnalyzer = isLiteral('standard')
type StandardAnalyzer = ValidatedType<typeof isStandardAnalyzer>

const isWhitespaceAnalyzer = isLiteral('whitespace')
type WhitespaceAnalyzer = ValidatedType<typeof isWhitespaceAnalyzer>

const isCharNGramAnalyzer = isObjectOf({
  type: isLiteral('char-ngram'),
  minGram: isNumber,
  maxGram: isNumber,
})
type CharNGramAnalyzer = ValidatedType<typeof isCharNGramAnalyzer>

const isDelimiterAnalyzer = isObjectOf({
  type: isLiteral('delimiter'),
  delimiter: isString,
  trimWhitespace: isBoolean,
})
type DelimiterAnalyzer = ValidatedType<typeof isDelimiterAnalyzer>

// NOTE: case is enforced here even though aito core is insensitive
const isSupportedLanguage = isLiteral(
  /* Arabic */ 'arabic',
  'ar',
  /* Armenian */ 'armenian',
  'hy',
  /* Basque */ 'basque',
  'eu',
  /* Brazilian Portuguese */ 'brazilian',
  'pt-br',
  /* Bulgarian */ 'bulgarian',
  'bg',
  /* Catalan */ 'catalan',
  'ca',
  /* Chinese, Japanese, Korean */ 'cjk',
  /* Czech */ 'czech',
  'cs',
  /* Danish */ 'danish',
  'da',
  /* Dutch */ 'dutch',
  'nl',
  /* English */ 'english',
  'en',
  /* Finnish */ 'finnish',
  'fi',
  /* French */ 'french',
  'fr',
  /* Galician */ 'galician',
  'gl',
  /* German */ 'german',
  'de',
  /* Greek */ 'greek',
  'el',
  /* Hindi */ 'hindi',
  'hi',
  /* Hungarian */ 'hungarian',
  'hu',
  /* Indonesian */ 'indonesian',
  'id',
  /* Irish */ 'irish',
  'ga',
  /* Italian */ 'italian',
  'it',
  /* Latvian */ 'latvian',
  'lv',
  /* Norwegian */ 'norwegian',
  'no',
  /* Persian */ 'persian',
  'fa',
  /* Portuguese */ 'portuguese',
  'pt',
  /* Romanian */ 'romanian',
  'ro',
  /* Russian */ 'russian',
  'ru',
  /* Spanish */ 'spanish',
  'es',
  /* Swedish */ 'swedish',
  'sv',
  /* Thai */ 'thai',
  'th',
  /* Turkish */ 'turkish',
  'tr',
)
export type SupportedLanguage = ValidatedType<typeof isSupportedLanguage>

const isLanguageAnalyzer = isObjectOf({
  type: isLiteral('language'),
  language: isSupportedLanguage,
  useDefaultStopWords: isBoolean,
  customStopWords: isArrayOf(isString).or(isUndefined),
  customKeyWords: isArrayOf(isString).or(isUndefined),
})
type LanguageAnalyzer = ValidatedType<typeof isLanguageAnalyzer>

interface TokenNGramAnalyzer {
  type: 'token-ngram'
  source: Analyzer
  minGram: number
  maxGram: number
  tokenSeparator: string
}
const isTokenNGramAnalyzer: Validator<TokenNGramAnalyzer> = isObjectOf({
  type: isLiteral('token-ngram'),
  source: fromLazy(() => isAnalyzer),
  minGram: isNumber,
  maxGram: isNumber,
  tokenSeparator: isString,
})

export type Analyzer =
  | StandardAnalyzer
  | WhitespaceAnalyzer
  | CharNGramAnalyzer
  | DelimiterAnalyzer
  | LanguageAnalyzer
  | TokenNGramAnalyzer

export const isAnalyzer: Validator<Analyzer> = isSomeOf(
  isStandardAnalyzer,
  isWhitespaceAnalyzer,
  isCharNGramAnalyzer,
  isDelimiterAnalyzer,
  isLanguageAnalyzer,
  isTokenNGramAnalyzer,
)

export type AnalyzerType = 'standard' | 'whitespace' | 'char-ngram' | 'delimiter' | 'language' | 'token-ngram'

const isBooleanColumn = isObjectOf({
  type: isLiteral('Boolean'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
})
export type BooleanColumn = ValidatedType<typeof isBooleanColumn>

const isIntColumn = isObjectOf({
  type: isLiteral('Int'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
})
export type IntColumn = ValidatedType<typeof isIntColumn>

const isLongColumn = isObjectOf({
  type: isLiteral('Long'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
})
export type LongColumn = ValidatedType<typeof isLongColumn>

const isDecimalColumn = isObjectOf({
  type: isLiteral('Decimal'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
})
export type DecimalColumn = ValidatedType<typeof isDecimalColumn>

const isStringColumn = isObjectOf({
  type: isLiteral('String'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
})
export type StringColumn = ValidatedType<typeof isStringColumn>

const isTextColumn = isObjectOf({
  type: isLiteral('Text'),
  nullable: isSomeOf(isBoolean, isUndefined),
  link: isSomeOf(isString, isUndefined),
  analyzer: isAnalyzer,
})
export type TextColumn = ValidatedType<typeof isTextColumn>

export const isColumnSchema = isSomeOf(
  isBooleanColumn,
  isIntColumn,
  isLongColumn,
  isDecimalColumn,
  isStringColumn,
  isTextColumn,
)
export type ColumnSchema = ValidatedType<typeof isColumnSchema>

export const isTableSchema = isObjectOf({
  type: isLiteral('table'),
  columns: isMapOf<ColumnSchema>(isColumnSchema),
})

export type TableSchema = ValidatedType<typeof isTableSchema>
