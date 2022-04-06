import _ from 'lodash'
import { useEffect, useState } from 'react'

const useEqualValue = <T>(value: T): T => {
  const [previousValue, setPreviousValue] = useState(value)
  useEffect(() => {
    if (!_.isEqual(value, previousValue)) {
      setPreviousValue(value)
    }
  }, [value, previousValue])
  return previousValue
}

export default useEqualValue
