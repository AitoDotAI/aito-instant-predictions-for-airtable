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
import { AttachmentMap, getAttachments } from './useAttachments'

const defaultMessage = (
  <Box marginBottom={1}>
    This is the expected rate at which you see this in a cell. No strong field correlations were found.
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
  attachmentMap: AttachmentMap
}> = ({ $p, $why, tableColumnMap, fields, attachmentMap, limit = 5 }) => {
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
    const up = (key: number) => (
      <Box display="inline-block" key={key}>
        <Icon fillColor={green} name="up" size={13} marginX="-2.5px" marginTop="1px" />
      </Box>
    )
    const down = (key: number) => (
      <Box display="inline-block" key={key}>
        <Icon fillColor={red} name="down" size={13} marginX="-2.5px" marginTop="4px" />
      </Box>
    )
    if (score < -2.0) {
      arrows = [down(0), down(1), down(2)]
    } else if (score < -0.5) {
      arrows = [down(0), down(1)]
    } else if (score < 0.0) {
      arrows = [down(0)]
    } else if (score <= 0.5) {
      arrows = [up(0)]
    } else if (score <= 2.0) {
      arrows = [up(0), up(1)]
    } else {
      arrows = [up(0), up(1), up(2)]
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
      const propId = acc.length

      if (!field) {
        return acc
      }
      const conversion = AcceptedFields[field.type]
      if (conversion) {
        convert = (x) => {
          let result = conversion.toCellValue(x, field.config)
          if (field.type === FieldType.MULTIPLE_ATTACHMENTS) {
            result = getAttachments(attachmentMap, result)
          }

          return result
        }
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

      const fieldHeader = (
        <Text textColor="white">
          <b>{fieldName}</b>
        </Text>
      )

      const isPropositions = propositions.filter(isIsProposition).map(({ $is }, i) => (
        <Box flexGrow={1} flexShrink={0} key={`${propId}-is-${i}`}>
          {fieldHeader}
          <CellRenderer style={{ margin: negativeMargin, color: 'white' }} field={field} cellValue={convert($is)} />
        </Box>
      ))

      const hasInputs = propositions.filter(isHasProposition)

      let hasPropositions: React.ReactNode = null
      if (hasInputs.length === 1) {
        const cellValue = convert(hasInputs[0].$has)
        if (field.type === FieldType.CHECKBOX && cellValue === false) {
          hasPropositions = (
            <Box flexGrow={1} flexShrink={0} key={`${propId}-has-0`}>
              {fieldHeader}
              <Text textColor="white" lineHeight={1.5}>
                <i>unchecked</i>
              </Text>
            </Box>
          )
        } else {
          hasPropositions = (
            <Box flexGrow={1} flexShrink={0} key={`${propId}-has-0`}>
              {fieldHeader}
              <CellRenderer style={{ margin: negativeMargin }} field={field} cellValue={cellValue} />
            </Box>
          )
        }
      } else if (hasInputs.length > 0) {
        if (field.type == FieldType.MULTIPLE_SELECTS) {
          hasPropositions = (
            <Box flexGrow={1} flexShrink={0} flexBasis="auto" maxWidth="100%" key={`${propId}-has-0`}>
              {fieldHeader}
              <CellRenderer
                style={{ margin: negativeMargin, color: 'white' }}
                field={field}
                cellValue={hasInputs.map((v) => ({ name: v.$has }))}
              />
            </Box>
          )
        } else if (field.type === FieldType.MULTIPLE_COLLABORATORS) {
          hasPropositions = (
            <Box flexGrow={1} flexShrink={0} flexBasis="auto" maxWidth="100%" key={`${propId}-has-0`}>
              {fieldHeader}
              <CellRenderer
                style={{ margin: negativeMargin, color: 'white' }}
                field={field}
                cellValue={hasInputs.map((v) => ({ id: v.$has }))}
              />
            </Box>
          )
        } else {
          // A text field of some kind
          hasPropositions = (
            <Box flexGrow={1} flexShrink={0} flexBasis="auto" maxWidth="100%" key={`${propId}-has-0`}>
              {fieldHeader}
              <CellRenderer
                style={{ margin: negativeMargin, color: 'white' }}
                field={field}
                cellValue={hasInputs.map((v) => v.$has).join(', ')}
              />
            </Box>
          )
        }
      }

      const numericPropositions = propositions.filter(isNumericProposition).map(({ $numeric }, i) => (
        <Box flexGrow={1} flexShrink={0} flexBasis="auto" key={`${propId}-num-${i}`}>
          {fieldHeader}
          <CellRenderer
            style={{ margin: negativeMargin, color: 'white' }}
            field={field}
            cellValue={convert($numeric)}
          />
        </Box>
      ))

      return [...acc, ...isPropositions, hasPropositions, ...numericPropositions]
    }, [] as React.ReactNode[])

    return (
      <Box key={i} display="flex" flexWrap="nowrap" marginBottom={1}>
        <Box
          style={{ verticalAlign: 'top' }}
          alignSelf="start"
          textColor="white"
          marginTop={i > 0 ? '1px' : undefined}
          flexGrow={0}
          flexShrink={0}
          flexBasis={32}
          paddingTop={1}
          textAlign="right"
          paddingRight={1}
        >
          {arrows}
        </Box>
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
      {descriptions.length > 0 ? (
        <>
          <Text paddingBottom={1} textColor="white">
            The prediction is based on
          </Text>
          {descriptions}

          {droppedComponentCount > 0 && (
            <Text marginTop={2} paddingBottom={1} textColor="white">
              and {droppedComponentCount} less important indicator{droppedComponentCount !== 1 ? 's' : ''}.
            </Text>
          )}
        </>
      ) : (
        defaultMessage
      )}
    </Box>
  )
}

export default ExplanationBox
