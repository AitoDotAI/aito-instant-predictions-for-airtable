import { Validator } from './validation'

// eslint-disable-next-line @typescript-eslint/ban-types
interface ValidatorClass<T extends S, S extends object> {
  new (value: S): T
  validator: Validator<T, S>
}

/**
 * ValidatorClass defines a class for a validated type. The class contains
 * meta-data that is available at run-time and can be used by e.g. nestjs
 * PipeTransforms to validate parameters and bodies. While it's possible to
 * create instances using the constructor and defining methods on derived
 * classes, it's not recommended.
 *
 * @param validator
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function ValidatorClass<T extends S, S extends object>(validator: Validator<T, S>): ValidatorClass<T, S> {
  return class {
    constructor(value: S) {
      const result = validator.strip(value)
      const descs = Object.getOwnPropertyDescriptors(result)
      Object.defineProperties(this, descs)
    }
    static validator: Validator<T, S> = validator
  } as ValidatorClass<T, S>
}
