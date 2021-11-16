import { Field } from '@airtable/blocks/models'
import { Box } from '@airtable/blocks/ui'
import React from 'react'
import AcceptedFields from '../AcceptedFields'
import {
  isHasProposition,
  isIsProposition,
  isNumericProposition,
  RelatedExplanation,
  simpleExplanation,
  SimpleProposition,
  Why,
} from '../explanations'
import { TableColumnMap } from '../schema/config'

const oxfordCommaList = (nodes: React.ReactNode[], addLinebreaks: Boolean = false): React.ReactNode[] => {
  if (nodes.length < 2) {
    return nodes
  }
  const separator = addLinebreaks ? <br /> : ' '
  if (nodes.length === 2) {
    return [nodes[0], <> and{separator}</>, nodes[1]]
  }
  const result = [nodes[0]]
  // Add commas
  for (let i = 1; i < nodes.length; i += 1) {
    if (i + 1 < nodes.length) {
      result[2 * i - 1] = <>,{separator}</>
    } else {
      result[2 * i - 1] = <>, and{separator}</>
    }
    result[2 * i] = nodes[i]
  }
  return result
}

const defaultMessage = (
  <Box marginBottom={1}>
    The expected rate at which you see this in a cell. No significant correlations with the record's other fields were
    found.
  </Box>
)

export const DefaultExplanationBox: React.FC = () => (
  <Box
    paddingX={2}
    paddingTop={2}
    paddingBottom={1}
    display="inline-flex"
    flexDirection="column"
    justifyContent="stretch"
    style={{ whiteSpace: 'normal', width: '100%' }}
  >
    {defaultMessage}
  </Box>
)

const ExplanationBox: React.FC<{
  $p: number
  $why: Why
  tableColumnMap: TableColumnMap
  fields: Field[]
}> = ({ $p, $why, tableColumnMap, fields }) => {
  if (!$why) {
    return <React.Fragment />
  }
  const explanation = simpleExplanation($p, $why)

  const descriptions = explanation
    .filter((e): e is RelatedExplanation => e.type === 'relatedPropositionLift')
    .map(({ score, propositions }, i) => {
      let arrows: string = ''
      if (score < -2.0) {
        arrows = '↓↓↓'
      } else if (score < -0.5) {
        arrows = '↓↓'
      } else if (score < 0.0) {
        arrows = '↓'
      } else if (score <= 0.5) {
        arrows = '↑'
      } else if (score <= 2.0) {
        arrows = '↑↑'
      } else {
        arrows = '↑↑↑'
      }

      type GroupedProposition = globalThis.Record<string, SimpleProposition[]>
      const groupedPropositions = propositions.reduce<GroupedProposition>((acc, [columnName, proposition]) => {
        const list = acc[columnName] || []
        return { ...acc, [columnName]: [...list, proposition] }
      }, {})

      const havingState = Object.entries(groupedPropositions).reduce((acc, [columnName, propositions]) => {
        const maybeEntry = Object.entries(tableColumnMap).find((x) => x[1].name === columnName)
        const fieldId = (maybeEntry || [])[0]
        const field = fields.find((f) => f.id === fieldId)
        const fieldName = field?.name || columnName
        let convert = (e: any): any => e

        if (field) {
          const conversion = AcceptedFields[field.type]
          if (conversion) {
            convert = (x) => conversion.toTextValue(x)
          }
        }

        // Don't merge $is propositions
        const isPropositions = propositions.filter(isIsProposition).map(({ $is }) => (
          <>
            <i>{fieldName}</i> is
            <b>{convert($is)}</b>
          </>
        ))

        // Merge $has propositions
        const convertedHasPropositions = propositions.filter(isHasProposition).map(({ $has }) => <b>{convert($has)}</b>)
        let hasPropositions: React.ReactNode[] = []
        if (convertedHasPropositions.length > 0) {
          const list = oxfordCommaList(convertedHasPropositions)
          hasPropositions = [
            <>
              <i>{fieldName}</i> has {list}
            </>,
          ]
        }

        const numericPropositions = propositions.filter(isNumericProposition).map((proposition) => {
          return (
            <>
              <i>{fieldName}</i> is roughly <b>{convert(proposition.$numeric)}</b>
            </>
          )
        })

        return [...acc, ...isPropositions, ...hasPropositions, ...numericPropositions]
      }, [] as React.ReactNode[])

      return (
        <Box key={i} display="flex" marginBottom={1}>
          <Box flexGrow={0} flexShrink={0} flexBasis={32}>
            {arrows}
          </Box>
          <Box flexGrow={1}>{oxfordCommaList(havingState, true)}</Box>
        </Box>
      )
    })

  return (
    <Box
      paddingX={2}
      paddingTop={2}
      paddingBottom={1}
      display="inline-flex"
      flexDirection="column"
      justifyContent="stretch"
      style={{ whiteSpace: 'normal', width: '100%' }}
    >
      {descriptions.length > 0 ? descriptions : defaultMessage}
    </Box>
  )
}

export default ExplanationBox
