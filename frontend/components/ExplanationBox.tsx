import { AllStylesProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Field } from '@airtable/blocks/models'
import { Text, Box, CellRenderer } from '@airtable/blocks/ui'
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

const AlignedText: React.FC<AllStylesProps> = ({ children, ...props }) => (
  <Text
    style={{ verticalAlign: 'top' }}
    alignSelf="start"
    textColor="white"
    display="inline-block"
    paddingY={2}
    {...props}
  >
    {children}
  </Text>
)

const oxfordCommaList = (nodes: React.ReactNode[], addLinebreaks: Boolean = false): React.ReactNode[] => {
  if (nodes.length < 2) {
    return nodes
  }
  const separator = ' ' //addLinebreaks ? <br /> : ' '
  if (nodes.length === 2) {
    return [nodes[0], <AlignedText>and</AlignedText>, nodes[1]]
  }
  const result = [nodes[0]]
  // Add commas
  for (let i = 1; i < nodes.length; i += 1) {
    if (i + 1 < nodes.length) {
      result[2 * i - 1] = <AlignedText>,{separator}</AlignedText>
    } else {
      result[2 * i - 1] = <AlignedText>, and{separator}</AlignedText>
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

        if (!field) {
          return acc
        }
        const conversion = AcceptedFields[field.type]
        if (conversion) {
          convert = (x) => conversion.toCellValue(x)
        }

        // Don't merge $is propositions
        const isPropositions = propositions.filter(isIsProposition).map(({ $is }) => (
          <>
            <i>{fieldName}</i> is
            <CellRenderer
              field={field}
              cellValue={convert($is)}
              renderInvalidCellValue={(v) => <>{String(v)}</>}
              cellStyle={{
                padding: 0,
              }}
              style={{
                display: 'inline-block',
                padding: 0,
                lineHeight: 1.25,
              }}
            />
            {/*<b>{convert($is)}</b>*/}
          </>
        ))

        // Merge $has propositions
        const convertedHasPropositions = propositions
          .filter(isHasProposition)
          .map(({ $has }) => <CellRenderer field={field} cellValue={convert($has)} display="inline-block" />)

        /*
          style={{
                verticalAlign: 'text-bottom',
                lineHeight: 'inherit',
              }}
              cellStyle={{
                fontWeight: 'bold',
                verticalAlign: 'text-bottom',
                padding: 0,
                lineHeight: 2/3,
              }}
        */

        let hasPropositions: React.ReactNode[] = []
        if (convertedHasPropositions.length > 0) {
          const list = oxfordCommaList(convertedHasPropositions)
          hasPropositions = [
            <Box display="flex">
              <AlignedText flexShrink={0} flexGrow={0} flexBasis="auto">
                <i>{fieldName}</i> is
              </AlignedText>
              <Box flexGrow={1}>{list}</Box>
            </Box>,
          ]
        }

        const numericPropositions = propositions.filter(isNumericProposition).map(({ $numeric }) => (
          <Box display="flex">
            <AlignedText flexShrink={0} flexGrow={0} flexBasis="auto">
              <i>{fieldName}</i> is about
            </AlignedText>
            <Box flexGrow={1}>
              <CellRenderer field={field} cellValue={convert($numeric)} />
            </Box>
          </Box>
        ))

        return [...acc, ...isPropositions, ...hasPropositions, ...numericPropositions]
      }, [] as React.ReactNode[])

      return (
        <Box key={i} display="flex" marginBottom={0}>
          <AlignedText flexGrow={0} flexShrink={0} flexBasis={32}>
            {arrows}
          </AlignedText>
          <Box display="flex" flexDirection="column">
            {havingState}
          </Box>
          {/*<Box flexGrow={1}>{oxfordCommaList(havingState, true)}</Box>*/}
        </Box>
      )
    })

  return (
    <Box
      paddingX={2}
      paddingTop={0}
      paddingBottom={0}
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
