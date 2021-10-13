import { Text, Link } from '@airtable/blocks/ui'
import React from 'react'

const QueryQuotaExceeded = (props: Parameters<typeof Text>[0]) => (
  <Text {...props} variant="paragraph">
    Query quota exeeded. The query count is reset on the first day of each month. You can also increase your quota in
    the{' '}
    <Link target="_blank" href="https://console.aito.ai">
      Aito.ai console
    </Link>
    .
  </Text>
)

export default QueryQuotaExceeded
