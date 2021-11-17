import { AllStylesProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Field, FieldType } from '@airtable/blocks/models'
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
    return [nodes[0], <> and </>, nodes[1]]
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
          .map(({ $has }) => {
            if (field.type === FieldType.MULTILINE_TEXT) {
              return <b>{$has}</b>
            } else {
              return <CellRenderer field={field} cellValue={convert($has)} display="inline-block" marginLeft={1} />
            }
          })

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
                <i>{fieldName}</i> has
              </AlignedText>
              <Box flexGrow={1}>{list}</Box>
            </Box>,
          ]
        }

        const negativeMargin = [
            FieldType.MULTILINE_TEXT,
            FieldType.NUMBER,
            FieldType.PERCENT,
            FieldType.PHONE_NUMBER,
            FieldType.SINGLE_LINE_TEXT,
            FieldType.AUTO_NUMBER,
            FieldType.BARCODE,
            FieldType.CURRENCY,
            FieldType.DATE,
            FieldType.DATE_TIME,
            FieldType.DURATION,
            FieldType.EMAIL,
          ].indexOf(field.type) >= 0 ? '-6px' : '0'

        const hasProps = propositions.filter(isHasProposition)

        if (hasProps.length === 1) {
          hasPropositions = [
          <Box flexGrow={1} flexShrink={0}>
            <Text textColor="white"><b>{fieldName}</b></Text>
            <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={convert(hasProps[0].$has)} />
          </Box>
          ]
        } else if (hasProps.length > 0) {
          // A text field of some kind
          hasPropositions = [
          <Box flexGrow={1} flexShrink={0} flexBasis="auto" maxWidth="100%">
            <Text textColor="white"><b>{fieldName}</b></Text>
            <Text textColor="white" margin={0}>
              <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={hasProps.map((v) => v.$has).join(', ')} />
            </Text>
          </Box>
          ]
        }

        const numericPropositions = propositions.filter(isNumericProposition).map(({ $numeric }) => (
          <Box flexGrow={1} flexShrink={0} flexBasis="auto">
            <Text textColor="white"><b>{fieldName}</b></Text>
            <CellRenderer  style={{ margin: negativeMargin }}  field={field} cellValue={convert($numeric)} />
          </Box>
        ))

        return [...acc, ...isPropositions, ...hasPropositions, ...numericPropositions]
      }, [] as React.ReactNode[])

      return (
        <Box key={i} display="flex" marginBottom={1} flexWrap="nowrap">
          <AlignedText flexGrow={0} flexShrink={0} flexBasis={32} paddingTop={1} textAlign="right" paddingRight={1}>
            {arrows}
          </AlignedText>
          <Box display="flex" flexDirection="row" flexWrap="wrap" flexGrow={1} style={{ gap: '6px', borderTop: i > 0 ? 'thin solid gray' : undefined}} paddingTop={1}>
            {havingState}
          </Box>
          {/*<Box flexGrow={1}>{oxfordCommaList(havingState, true)}</Box>*/}
        </Box>
      )
    })

  return (
    <Box
      paddingX={2}
      paddingTop={1}
      marginBottom={0}
      display="flex"
      flexDirection="column"
      justifyContent="stretch"
      style={{ whiteSpace: 'normal', width: '100%' }}
    >
      {descriptions.length > 0 ? descriptions : defaultMessage}
    </Box>
  )
}

export default ExplanationBox
