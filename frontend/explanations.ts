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

type Proposition = DocumentProposition | IsProposition | HasFeatureProposition | NumericProposition | AndProposition

export const isIsProposition: Validator<IsProposition> = isObjectOf({
  $is: isSomeOf(isString, isNumber, isBoolean, isNull),
})

export const isHasProposition: Validator<HasFeatureProposition> = isObjectOf({
  $has: isSomeOf(isString, isNumber, isBoolean, isNull),
})

export const isNumericProposition: Validator<NumericProposition> = isObjectOf({
  $numeric: isSomeOf(isNumber),
})

const isSimpleProposition = isSomeOf(isIsProposition, isHasProposition, isNumericProposition)

export const isAndProposition: Validator<AndProposition> = isObjectOf({
  $and: isArrayOf(fromLazy(() => isProposition)),
})

export const isDocumentProposition: Validator<DocumentProposition> = isMapOf(fromLazy(() => isProposition))

export const isProposition = isSomeOf(isSimpleProposition, isAndProposition, isDocumentProposition)

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
  proposition: FieldProposition[]
  value: number
}

export interface Normalizer {
  type: 'normalizer'
  name: string
  value: number
}

export type Why = Normalizer | BaseWhy | ProductWhy | RelatedPropositionLift

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
        const propositions: FieldProposition[] = []

        const getPropositions = (prop: any) => {
          if (isAndProposition(prop)) {
            prop.$and.forEach(getPropositions)
          } else if (isDocumentProposition(prop)) {
            const entries = Object.entries(prop)
            const firstEntry = entries[0]
            const fieldName = firstEntry[0]
            const simpleProposition = firstEntry[1]
            if (fieldName && isSimpleProposition(simpleProposition)) {
              propositions.push([fieldName, simpleProposition])
            }
          }
        }
        getPropositions($why.proposition)

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
