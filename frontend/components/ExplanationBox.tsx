import { AllStylesProps } from '@airtable/blocks/dist/types/src/ui/system'
import { Field, FieldType } from '@airtable/blocks/models'
import { Text, Box, CellRenderer, Icon, colors, colorUtils } from '@airtable/blocks/ui'
import _ from 'lodash'
import React from 'react'
import AcceptedFields from '../AcceptedFields'
import {
  isHasProposition,
  isIsProposition,
  isNumericProposition,
  RelatedExplanation,
  SimpleExplanation,
  simpleExplanation,
  SimpleProposition,
  Why,
} from '../explanations'
import { TableColumnMap } from '../schema/config'

const AlignedText: React.FC<AllStylesProps> = ({ children, ...props }) => (
  <Text style={{ verticalAlign: 'top' }} alignSelf="start" textColor="white" {...props}>
    {children}
  </Text>
)

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
  limit?: number
}> = ({ $p, $why, tableColumnMap, fields, limit = 5 }) => {
  if (!$why) {
    return <React.Fragment />
  }
  const explanation = simpleExplanation($p, $why)

  const sortByAbsScore = (a: SimpleExplanation, b: SimpleExplanation) => Math.abs(b.score) - Math.abs(a.score)

  const propositionLifts = explanation.filter((e): e is RelatedExplanation => e.type === 'relatedPropositionLift')
  propositionLifts.sort(sortByAbsScore)
  const sortedExplanations = Number.isFinite(limit) ? _.take(propositionLifts, limit) : propositionLifts

  const droppedComponentCount = propositionLifts.length - sortedExplanations.length

  const descriptions = sortedExplanations.map(({ score, propositions }, i) => {
    let arrows: React.ReactNode[] = []
    const green = colorUtils.getHexForColor(colors.GREEN_DARK_1)
    const red = colorUtils.getHexForColor(colors.RED_DARK_1)
    const up = (
      <Box display="inline-block">
        <Icon fillColor={green} name="up" size={13} marginX="-2.5px" marginTop="1px" />
      </Box>
    )
    const down = (
      <Box display="inline-block">
        <Icon fillColor={red} name="down" size={13} marginX="-2.5px" marginTop="4px" />
      </Box>
    )
    if (score < -2.0) {
      arrows = [down, down, down]
    } else if (score < -0.5) {
      arrows = [down, down]
    } else if (score < 0.0) {
      arrows = [down]
    } else if (score <= 0.5) {
      arrows = [up]
    } else if (score <= 2.0) {
      arrows = [up, up]
    } else {
      arrows = [up, up, up]
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

      const negativeMargin =
        [
          FieldType.MULTILINE_TEXT,
          FieldType.MULTIPLE_SELECTS,
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
        ].indexOf(field.type) >= 0
          ? '-6px'
          : '0'

      const isPropositions = propositions.filter(isIsProposition).map(({ $is }) => (
        <Box flexGrow={1} flexShrink={0}>
          <Text textColor="white">
            <b>{fieldName}</b>
          </Text>
          <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={convert($is)} />
        </Box>
      ))

      const hasInputs = propositions.filter(isHasProposition)

      let hasPropositions: React.ReactNode[] = []
      if (hasInputs.length === 1) {
        hasPropositions = [
          <Box flexGrow={1} flexShrink={0}>
            <Text textColor="white">
              <b>{fieldName}</b>
            </Text>
            <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={convert(hasInputs[0].$has)} />
          </Box>,
        ]
      } else if (hasInputs.length > 0) {
        // A text field of some kind
        hasPropositions = [
          <Box flexGrow={1} flexShrink={0} flexBasis="auto" maxWidth="100%">
            <Text textColor="white">
              <b>{fieldName}</b>
            </Text>
            <Text textColor="white" margin={0}>
              <CellRenderer
                style={{ margin: negativeMargin }}
                field={field}
                cellValue={hasInputs.map((v) => v.$has).join(', ')}
              />
            </Text>
          </Box>,
        ]
      }

      const numericPropositions = propositions.filter(isNumericProposition).map(({ $numeric }) => (
        <Box flexGrow={1} flexShrink={0} flexBasis="auto">
          <Text textColor="white">
            <b>{fieldName}</b>
          </Text>
          <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={convert($numeric)} />
        </Box>
      ))

      return [...acc, ...isPropositions, ...hasPropositions, ...numericPropositions]
    }, [] as React.ReactNode[])

    return (
      <Box key={i} display="flex" flexWrap="nowrap" marginBottom={1}>
        <AlignedText
          marginTop={i > 0 ? '1px' : undefined}
          flexGrow={0}
          flexShrink={0}
          flexBasis={32}
          paddingTop={1}
          textAlign="right"
          paddingRight={1}
        >
          {arrows}
        </AlignedText>
        <Box
          display="flex"
          flexDirection="row"
          flexWrap="wrap"
          flexGrow={1}
          style={{ gap: '6px', borderTop: i > 0 ? '1px solid gray' : undefined }}
          paddingTop={1}
        >
          {havingState}
        </Box>
      </Box>
    )
  })

  return (
    <Box
      paddingX={2}
      paddingTop={1}
      display="flex"
      flexDirection="column"
      justifyContent="stretch"
      style={{ whiteSpace: 'normal', width: '100%' }}
    >
      <Text paddingBottom={1} textColor="white">
        The prediction is based on
      </Text>
      {descriptions.length > 0 ? descriptions : defaultMessage}
      {droppedComponentCount > 0 && (
        <Text marginTop={2} paddingBottom={1} textColor="white">
          and {droppedComponentCount} less important indicator{droppedComponentCount !== 1 ? 's' : ''}.
        </Text>
      )}
    </Box>
  )
}

export default ExplanationBox
