import _ from 'lodash'
import { useEffect, useState } from 'react'

const useEqualValue = <T>(value: T, isEqual: (lhs: T, rhs: T) => boolean = _.isEqual): T => {
  const [previousValue, setPreviousValue] = useState(value)
  useEffect(() => {
    if (!isEqual(value, previousValue)) {
      setPreviousValue(value)
    }
  }, [value, previousValue])
  return previousValue
}

export default useEqualValue
