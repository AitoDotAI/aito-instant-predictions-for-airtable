import _ from 'lodash'

export class ValidationError extends Error {
  constructor(
    public readonly description: string,
    public readonly value: unknown,
    public readonly root: any = value,
    public readonly path: (number | string)[] = [],
  ) {
    super(
      `Validation of ${root} failed${path.length > 0 ? ` at ${JSON.stringify(path)} = ${value}` : ''}: ${description}`,
    )
    const error: any = Error
    if ('captureStackTrace' in error) {
      error.captureStackTrace(this, this.constructor)
    }
  }
}

// Validator that checks if a value of type S is compatible with type T
export interface Validator<T extends S, S = unknown> {
  // Type predicate that can be used in if-statements
  (value: S): value is T

  // Return validated result or throw an exception
  validate: (value: S) => T

  // Makes a validator for the union type T | U, which passes if either this or
  // the other validator accepts the value
  or: <U extends S>(validator: Validator<U, S>) => Validator<T | U, S>

  // Makes a validator for the intersection type T & U, which passes if both
  // this and the other validator accepts the value
  and: <U extends S>(validator: Validator<U, S>) => Validator<T & U, S>

  // Compose with another validator. The second Validator that checks an
  // additional property of the validated value, and can narrow the type down if
  // U != T
  which: <U extends T>(validator: Validator<U, T>) => Validator<U, S>

  // Validates S and recursively removes fields not present in T
  strip(value: S): T
}

export type ValidatedType<T> = T extends Validator<infer A, any> ? A : never
export type ValidationType<T> = T extends Validator<any, infer B> ? B : never

type ValidatedTypes<A extends [...Validator<any, any>[]]> = { [i in keyof A]: ValidatedType<A[i]> }

type ValidationTypes<A extends [...Validator<any, any>[]]> = { [i in keyof A]: ValidationType<A[i]> }

type IsCompatible<A, B> = A extends B ? A : never

// TupleIntersection: turn tuple type [A, B, C] into A & B & C
// Note: without the wrapping something like [X | Y, Z] turns into X & Y & Z
type TupleIntersection<T extends any[]> = UnwrapTypes<UnionAsIntersection<TupleTypes<WrapTypes<T>>>>

// TupleKeyOf: like "keyof" but with only the tuple indices. By contrast, the
// type keyof includes the keys of every array method, including the indexing
// operator.
// [X | Y, Z] -> 0 | 1
type TupleKeyOf<T extends any[]> = Exclude<keyof T, keyof []>

// WrapTypes: wrap each type of a tuple in an object so that we don't erase
// types
// [X | Y, Z] -> [[X | Y], [Z]]
type WrapTypes<T extends any[]> = { [i in keyof T]: [T[i]] }

// TupleTypes: expand tuple into a union of types
// [[X | Y], Z] -> [X | Y] | [Z]
type TupleTypes<T extends any[]> = T[TupleKeyOf<T>]

// UnionAsIntersection: Turn union into intersection
// [X | Y] | [Z] -> [X | Y] & [Z]
type UnionAsIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

// UnwrapTypes: remove tuple wrapper
// [X | Y] & [Z] -> (X & Z) | (Y & Z)
type UnwrapTypes<T> = T extends [any] ? T[0] : never

export function Validator<T extends S, S>(
  validate: (value: S) => T,
  strip: (value: S) => T = validate,
): Validator<T, S> {
  function check(value: S): value is T {
    try {
      validate(value)
      return true
    } catch (e) {
      return false
    }
  }

  function which<U extends T>(other: Validator<U, T>): Validator<U, S> {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return compose(other, check)
  }

  function or<U extends S>(other: Validator<U, S>): Validator<T | U, S> {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return isSomeOf(check as Validator<T, S>, other)
  }

  function and<U extends S>(other: Validator<U, S>): Validator<T & U, S> {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return isAllOf(check as Validator<T, S>, other)
  }

  check.or = or
  check.and = and
  check.validate = validate
  check.which = which
  check.strip = strip

  return check
}

export function compose<A extends C, B extends A, C>(isB: Validator<B, A>, isA: Validator<A, C>): Validator<B, C> {
  function validate(value: C): B {
    return isB.validate(isA.validate(value))
  }
  function strip(value: C): B {
    return isB.strip(isA.strip(value))
  }
  return Validator(validate, strip)
}

// The validated type of isSomeOf(a, b, c, ...), or never if a, b, c, ... don't
// have a compatible validation type
type SomeOfValidatedType<A extends [...Validator<any, any>[]]> = IsCompatible<
  ValidatedTypes<A>,
  { [i in keyof A]: TupleIntersection<ValidationTypes<A>> }
>[TupleKeyOf<A>]

// The common base type of a isSomeOf validation
type SomeOfValidationType<A extends [...Validator<any, any>[]]> = TupleIntersection<ValidationTypes<A>>

// Is one of the validators' type
export function isSomeOf<A extends [...Validator<any, any>[]]>(
  ...validators: A
): Validator<SomeOfValidatedType<A>, SomeOfValidationType<A>> {
  type Source = SomeOfValidationType<A>
  type Target = SomeOfValidatedType<A>

  // Try to validate any of the validators
  function apply(fs: ((value: Source) => Target)[]): (value: Source) => Target {
    return (value) => {
      const messages: string[] = new Array(fs.length)
      for (let i = 0; i < fs.length; i++) {
        try {
          return fs[i](value)
        } catch (e) {
          if (e instanceof ValidationError) {
            messages[i] = e.message
          } else {
            throw e
          }
        }
      }
      throw new ValidationError(messages.join(' nor '), value)
    }
  }

  const validate = apply(validators.map((v: Validator<Target, Source>) => v.validate))
  const strip = apply(validators.map((v: Validator<Target, Source>) => v.strip))

  return Validator(validate, strip)
}

// [Validator<A, ?>, Validator<B, ?>, ...] -> A & B & ...
type IsAllOfValidatedType<A extends [...Validator<any, any>[]]> = TupleIntersection<ValidatedTypes<A>>

// [Validator<?, X>, Validator<?, Y>, ...] -> X & Y & ...
type IsAllOfValidationType<A extends [...Validator<any, any>[]]> = TupleIntersection<ValidationTypes<A>>

export function isAllOf<A extends [...Validator<any, any>[]]>(
  ...validators: A
): Validator<IsAllOfValidatedType<A>, IsAllOfValidationType<A>> {
  type Source = IsAllOfValidationType<A>
  type Target = IsAllOfValidatedType<A>

  function validate(value: Source): Target {
    validators.forEach((v) => v.validate(value))
    return value as any as Target
  }
  function strip(value: Source): Target {
    return _.merge({}, ...validators.map((v) => v.strip(value)))
  }
  return Validator(validate, strip)
}

export function satisfiesCondition<T extends S, S = T>(
  predicate: (value: S) => boolean,
  describe: (value: S) => string = () => `does not satisfy ${predicate.toString()}`,
): Validator<T, S> {
  function validate(value: S): T & S {
    if (!predicate(value)) {
      throw new ValidationError(describe(value), value)
    }
    return value as any
  }
  return Validator(validate)
}

export function satisfiesPredicate<T extends S, S>(predicate: (value: S) => value is T): Validator<T, S> {
  return satisfiesCondition<T, S>(predicate, () => `does not satisfy ${predicate.name ?? predicate.toString()})`)
}

function isPrimiteiveType<T>(type: string): Validator<T> {
  return satisfiesCondition<T, unknown>(
    (v) => typeof v === type,
    (v) => `is ${typeof v} but expected ${type}`,
  )
}

export const isBoolean: Validator<boolean> = isPrimiteiveType<boolean>('boolean')
export const isNumber: Validator<number> = isPrimiteiveType<number>('number')
export const isString: Validator<string> = isPrimiteiveType<string>('string')
export const isNull: Validator<null> = satisfiesCondition<null, unknown>(
  (v) => v === null,
  (v) => `${v} is not null`,
)
export const isUndefined: Validator<undefined> = isPrimiteiveType<undefined>('undefined')
export const isAny: Validator<any> = satisfiesCondition<any, unknown>(
  () => true,
  () => 'anything is any',
)
export const isArray: Validator<unknown[]> = satisfiesCondition<unknown[], unknown>(
  Array.isArray,
  (v) => `${v} is not an array`,
)

export const isMissing: Validator<undefined | null> = isSomeOf(isUndefined, isNull)

// Validate that an unknown value is an object (not null)
// eslint-disable-next-line @typescript-eslint/ban-types
export const isObject: Validator<object> = satisfiesCondition<object, unknown>(
  (v) => v !== null && typeof v === 'object',
  (v) => `${v} is not an object`,
)

const isPositiveIntegerCondition = satisfiesCondition<number>(
  (n) => Number.isInteger(n) && n >= 1,
  (n) => `expected positive integer, got ${n}`,
)
export const isPositiveInteger: Validator<number> = isNumber.which(isPositiveIntegerCondition)

const isNaturalNumberCondition = satisfiesCondition<number>(
  (n) => Number.isInteger(n) && n >= 0,
  (n) => `expected positive integer or zero, got ${n}`,
)
export const isNaturalNumber = isNumber.which(isNaturalNumberCondition)

export const isHexString = isString.which(satisfiesCondition((s) => /^[a-z0-9]+$/i.test(s)))
export const isSha1SumHexString = isString.which(satisfiesCondition((s) => _.size(s) === 40)).and(isHexString)

// A value is in a set of literal values
export function isLiteral<T extends string | number | boolean>(...literals: T[]): Validator<T> {
  return satisfiesCondition<T, unknown>(
    (value) => (literals as any[]).includes(value),
    (value) => `${JSON.stringify(value)} is not in ${literals.map((l) => JSON.stringify(l)).join(', ')}`,
  )
}

// A value has constructor in prototype chain
export function isInstanceOf<T, Args extends any[]>(constructor: { new (...args: Args): T }): Validator<T> {
  return satisfiesCondition<T, unknown>(
    (value) => value instanceof constructor,
    (value) => `${value} is not ${constructor.name}`,
  )
}

// Array or string (or similar) has length within the bounds
export function hasLength<T extends { length: number }>(
  minLength: number,
  maxLength: number = Number.MAX_SAFE_INTEGER,
): Validator<T, T> {
  return Validator((value) => {
    if (value.length < minLength) {
      throw new ValidationError(`${value.length} is less than minimum ${minLength}`, value.length, value, ['length'])
    }
    if (value.length > maxLength) {
      throw new ValidationError(`${value.length} is greater than maximum ${maxLength}`, value.length, value, ['length'])
    }
    return value
  })
}

// Array or string (or similar) has exact length
export function hasExactLength<T extends { length: number }, Length extends number>(
  length: Length,
): Validator<T & { length: Length }, T> {
  return Validator((value) => {
    if (value.length === length) {
      return value as T & { length: Length }
    }
    throw new ValidationError(`length should be ${length}`, value.length, value, ['length'])
  })
}

// string which matches regular expression
export function matchesRegExp(re: RegExp): Validator<string, string> {
  return satisfiesCondition(
    (value) => re.test(value),
    () => `does not match ${re}`,
  )
}

function validateChild<T>(childValidator: Validator<T>, parent: any, key: string | number): void {
  try {
    childValidator.validate(parent[key])
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new ValidationError(e.description, e.value, parent, [key, ...e.path])
    }
    throw e
  }
}

function stripChild<T>(childValidator: Validator<T>, parent: any, key: string | number): T {
  try {
    return childValidator.strip(parent[key])
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new ValidationError(e.description, e.value, parent, [key, ...e.path])
    }
    throw e
  }
}

// Validate that an object have the given fields
/* eslint-disable @typescript-eslint/ban-types */
export function hasFields<T extends object>(
  fieldValidators: { [key in keyof Required<T>]: Validator<T[key]> },
): Validator<T, object> {
  type Key = keyof Required<T> & string
  const keys = Object.keys(fieldValidators) as Key[]

  function validate(value: any): T {
    for (const key of keys) {
      validateChild(fieldValidators[key], value, key)
    }
    return value as T
  }

  function strip(value: any): T {
    const result: Partial<Record<Key, any>> = {}
    for (const key of keys) {
      const fieldValue = stripChild(fieldValidators[key], value, key)
      if (fieldValue !== undefined) {
        result[key] = fieldValue
      }
    }
    return result as T
  }

  return Validator(validate, strip)
}

// Validate that an object have fields of type T
export function hasFieldsOf<T>(memberValidator: Validator<T>): Validator<{ [key in string]: T }, object> {
  type HasFieldsOf = { [key: string]: T }

  function validate(value: object): HasFieldsOf {
    // NOTE: for-in traverses all enumerable properties, including properties
    // inherited from the object's prototype. Validators assume that the objects
    // have been parsed JSON, and/or are plain data for use with the spread
    // operator (which also includes all enumerable properties).
    for (const key in value) {
      validateChild(memberValidator, value, key)
    }
    return value as HasFieldsOf
  }

  function strip(value: object): HasFieldsOf {
    const result: HasFieldsOf = {}
    for (const key in value) {
      result[key] = stripChild(memberValidator, value, key)
    }
    return result
  }

  return Validator(validate, strip)
}
/* eslint-enable @typescript-eslint/ban-types */

// Validate that an array (unknown[]) has tuple shape T
export function hasElements<T extends [any, ...any[]]>(
  validators: { [i in keyof T]: Validator<T[i]> },
): Validator<T, unknown[]> {
  function validate(array: unknown[]): T {
    for (let i = 0; i < validators.length; i++) {
      validateChild(validators[i], array, i)
    }
    return array as T
  }

  function strip(array: unknown[]): T {
    const result = new Array(validators.length)
    for (let i = 0; i < validators.length; i++) {
      result.push(stripChild(validators[i], array, i))
    }
    return result as T
  }

  return Validator(validate, strip)
}

// Validate that an array (unknown[]) has element types T
export function hasElementsOf<T>(elementValidator: Validator<T>): Validator<T[], unknown[]> {
  function validate(value: unknown[]): T[] {
    for (let i = 0; i < value.length; i++) {
      validateChild(elementValidator, value, i)
    }
    return value as T[]
  }

  function strip(value: unknown[]): T[] {
    return value.map((_, i) => stripChild(elementValidator, value, i))
  }

  return Validator(validate, strip)
}

// Common short-hands from unknown type:

// Is object with uniform field types
export function isMapOf<Value>(validator: Validator<Value>): Validator<{ [key in string]: Value }> {
  return isObject.which(hasFieldsOf<Value>(validator))
}

export function isRecordOf<Value>(validator: Validator<Value>): Validator<Record<string, Value>> {
  return isMapOf(validator)
}

// Is object with given fields
// eslint-disable-next-line @typescript-eslint/ban-types
export function isObjectOf<T extends object>(
  fieldValidators: { [key in keyof Required<T>]: Validator<T[key]> },
): Validator<T> {
  return isObject.which(hasFields<T>(fieldValidators))
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function isPartialObjectOf<T extends object>(
  fieldValidators: { [key in keyof Required<T>]: Validator<T[key]> },
): Validator<Partial<T>> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore-start
  const mapToOptional = (
    fv: { [k in keyof Partial<T>]: Validator<T[k]> },
  ): { [k in keyof Partial<T>]: Validator<T[k]> } => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return Object.fromEntries(Object.entries(fv).map(([k, v]) => [k, isMissing.or(v)]))
  }

  const partialFieldValidators = mapToOptional(fieldValidators)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return isObject.which(hasFields<T>(partialFieldValidators))
}

// Is array with uniform element type
export function isArrayOf<Value>(validator: Validator<Value>): Validator<Value[]> {
  return isArray.which(hasElementsOf<Value>(validator))
}

// Is tuple with given members
export function isTupleOf<T extends [any, ...any[]]>(validators: { [i in keyof T]: Validator<T[i]> }): Validator<T> {
  return isArray.which(hasElements<T>(validators))
}

// Lazy evaluation for recursive validators
export function fromLazy<T extends S, S>(make: () => Validator<T, S>): Validator<T, S> {
  let memo: Validator<T, S> | null = null
  function validateLazily(value: S): T {
    if (!memo) {
      memo = make()
    }
    return memo.validate(value)
  }

  function stripLazily(value: S): T {
    if (!memo) {
      memo = make()
    }
    return memo.strip(value)
  }

  return Validator(validateLazily, stripLazily)
}
