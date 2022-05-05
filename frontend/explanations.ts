import {
  isMapOf,
  isObjectOf,
  isSomeOf,
  isString,
  Validator,
  fromLazy,
  isNull,
  isBoolean,
  isNumber,
  ValidatedType,
  isArrayOf,
  satisfiesCondition,
} from './validator/validation'

type Literal = string | number | boolean | null

export interface DocumentProposition {
  [field: string]: Proposition
}

export interface IsProposition {
  $is: Literal
}

export interface HasFeatureProposition {
  $has: Literal
}

export interface NumericProposition {
  $numeric: number
}

export interface AndProposition {
  $and: Proposition[]
}

export interface NotProposition {
  $not: Proposition
}

type Proposition =
  | DocumentProposition
  | IsProposition
  | HasFeatureProposition
  | NumericProposition
  | AndProposition
  | NotProposition

export const isProposition: Validator<Proposition> = fromLazy(() =>
  isSomeOf(isSimpleProposition, isAndProposition, isDocumentProposition),
)

export const isSimpleProposition = fromLazy(() => isSomeOf(isIsProposition, isHasProposition, isNumericProposition))

export const isIsProposition: Validator<IsProposition> = isObjectOf({
  $is: isSomeOf(isString, isNumber, isBoolean, isNull),
})

export const isHasProposition: Validator<HasFeatureProposition> = isObjectOf({
  $has: isSomeOf(isString, isNumber, isBoolean, isNull),
})

export const isNumericProposition: Validator<NumericProposition> = isObjectOf({
  $numeric: isSomeOf(isNumber),
})

export const isNotProposition: Validator<NotProposition> = isObjectOf({ $not: isProposition })

export const isAndProposition: Validator<AndProposition> = isObjectOf({ $and: isArrayOf(isProposition) })

const keywords = ['$and', '$not', '$is', '$has', '$numeric']

export const isDocumentProposition: Validator<DocumentProposition> = isMapOf(isProposition).which(
  satisfiesCondition((map) => Object.keys(map).every((key) => !keywords.includes(key))),
)

export type SimpleProposition = ValidatedType<typeof isSimpleProposition>

export type FieldProposition = [string, SimpleProposition]

export interface BaseWhy {
  type: 'baseP'
  value: number
}

export interface ProductWhy {
  type: 'product'
  factors: Why[]
}

export interface RelatedPropositionLift {
  type: 'relatedPropositionLift'
  proposition: Proposition
  value: number
}

export interface HitPropositionLift {
  type: 'hitPropositionLift'
  proposition: Proposition
  factors: Why[]
  value: number
}

export interface Normalizer {
  type: 'normalizer'
  name: string
  value: number
}

export type Why = Normalizer | BaseWhy | ProductWhy | HitPropositionLift | RelatedPropositionLift

const ln2 = Math.log(2.0)
const log2 = (n: number): number => Math.log(n) / ln2

export interface ConstantExplanation {
  type: 'baseP' | 'normalizer'
  score: number
  value: number
}

export interface RelatedExplanation {
  type: 'relatedPropositionLift'
  score: number
  value: number
  propositions: FieldProposition[]
}

export type SimpleExplanation = ConstantExplanation | RelatedExplanation

const getFieldPropositions = (prop: Proposition): FieldProposition[] => {
  if (isAndProposition(prop)) {
    return prop.$and.reduce<FieldProposition[]>((acc, prop) => [...acc, ...getFieldPropositions(prop)], [])
  } else if (isDocumentProposition(prop)) {
    const entries = Object.entries(prop)
    const firstEntry = entries[0]
    const fieldName = firstEntry[0]
    const simpleProposition = firstEntry[1]
    if (fieldName && isSimpleProposition(simpleProposition)) {
      return [[fieldName, simpleProposition]]
    }
  }
  return []
}

export const simpleExplanation = ($p: number, $why: Why): SimpleExplanation[] => {
  const parts: Array<[number, SimpleExplanation]> = []
  const makeScore = (p: number): number => log2(p)
  const rec = ($why: Why): number => {
    switch ($why.type) {
      case 'product':
        return $why.factors.reduce((a, b) => a * rec(b), 1.0)

      case 'baseP':
        parts.push([0, { type: 'baseP', score: makeScore($why.value), value: $why.value }])
        return $why.value

      case 'normalizer':
        parts.push([2, { type: 'normalizer', score: makeScore($why.value), value: $why.value }])
        return $why.value

      case 'relatedPropositionLift': {
        const propositions = getFieldPropositions($why.proposition)

        parts.push([
          1,
          {
            type: 'relatedPropositionLift',
            score: makeScore($why.value),
            value: $why.value,
            propositions,
          },
        ])
        return $why.value
      }

      default:
        return 1.0
    }
  }
  const total = rec($why)
  parts.sort((a, b) => a[0] - b[0] || b[1].score - a[1].score)
  const result = parts.filter((x) => x[0] !== 2).map((x) => x[1])
  const normalizers = parts.filter((x) => x[0] === 2).reduce((a, b) => a * b[1].value, 1.0)
  const other = $p / total

  const norm = normalizers * other
  result.push({ type: 'normalizer', value: norm, score: makeScore(norm) })

  return result
}

export interface HitExplanation {
  type: 'hitPropositionLift'
  isNegated: boolean
  hitFieldId: string
  value: number
  score: number
  contextFieldIds: string[]
}

export type MatchExplanation = ConstantExplanation | HitExplanation

export const matchExplanation = ($p: number, $why: Why): MatchExplanation[] => {
  const parts: [number, MatchExplanation][] = []
  const makeScore = (p: number): number => log2(p)

  const rec = ($why: Why): void => {
    switch ($why.type) {
      case 'product':
        $why.factors.forEach(rec)
        break
      case 'baseP':
      case 'normalizer':
      case 'relatedPropositionLift':
        break

      case 'hitPropositionLift': {
        let { proposition } = $why
        let isNegated = false

        if (isNotProposition(proposition)) {
          isNegated = true
          proposition = proposition.$not
        }

        if (!isDocumentProposition(proposition)) {
          return
        }

        const simpleExplanations = $why.factors
          .reduce((acc, factor) => [...acc, ...simpleExplanation(1, factor)], [] as SimpleExplanation[])
          .filter((exp): exp is RelatedExplanation => exp.type === 'relatedPropositionLift')

        const contextFieldIds = simpleExplanations.reduce<string[]>(
          (list, explanation) => [
            ...list,
            ...explanation.propositions.reduce<string[]>((acc2, [fieldName]) => {
              const [, fieldId] = fieldName.split('.')
              if (fieldId && acc2.indexOf(fieldId) < 0 && list.indexOf(fieldId) < 0) {
                return [...acc2, fieldId]
              } else {
                return acc2
              }
            }, []),
          ],
          [],
        )

        parts.push([
          1,
          {
            type: 'hitPropositionLift',
            score: makeScore($why.value),
            value: $why.value,
            isNegated,
            hitFieldId: Object.keys(proposition)[0],
            contextFieldIds,
          },
        ])
      }
    }
  }
  rec($why)
  parts.sort((a, b) => a[0] - b[0] || b[1].score - a[1].score)
  const result = parts.filter((x) => x[0] !== 2).map((x) => x[1])

  return result
}
