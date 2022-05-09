import { TextButton } from '@airtable/blocks/ui'
import _ from 'lodash'
import React, { useState } from 'react'

function ExpandableList<T>(params: {
  children: (params: { list: T[] }) => React.ReactElement | null | (React.ReactElement | null)[]
  list: T[] | undefined | null
  headSize: number
}): React.ReactElement | null {
  const { children, list, headSize } = params

  if (!list || list.length === 0) {
    return null
  }

  const [isExpanded, setExpanded] = useState(false)
  const limitedList = isExpanded ? list : _.take(list, headSize)

  return (
    <>
      {children({ list: limitedList })}
      {headSize < list.length && (
        <TextButton marginX={3} marginTop={1} onClick={() => setExpanded(!isExpanded)} variant="light">
          Show {isExpanded ? 'less' : 'more'}
        </TextButton>
      )}
    </>
  )
}

export default ExpandableList
