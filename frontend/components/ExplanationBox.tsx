import { Record, Field, FieldType, TableOrViewQueryResult } from '@airtable/blocks/models'
import {
  Text,
  Box,
  CellRenderer,
  Icon,
  colors,
  colorUtils,
  FieldIcon,
  useLoadable,
  useWatchable,
} from '@airtable/blocks/ui'
import _ from 'lodash'
import React from 'react'
import AcceptedFields from '../AcceptedFields'
import {
  HitExplanation,
  isHasProposition,
  isIsProposition,
  isNumericProposition,
  MatchExplanation,
  matchExplanation,
  RelatedExplanation,
  SimpleExplanation,
  simpleExplanation,
  SimpleProposition,
  Why,
} from '../explanations'
import { TableColumnMap } from '../schema/config'
import { FieldMap } from './PredictView'
import { InlineFieldIcon } from './ui'

const green = colorUtils.getHexForColor(colors.GREEN_DARK_1)
const red = colorUtils.getHexForColor(colors.RED_DARK_1)
const UpArrow = () => (
  <Box display="inline-block">
    <Icon fillColor={green} name="up" size={13} marginX="-2.5px" marginTop="1px" />
  </Box>
)
const DownArrow = () => (
  <Box display="inline-block">
    <Icon fillColor={red} name="down" size={13} marginX="-2.5px" marginTop="4px" />
  </Box>
)

const ArrowScore: React.FC<{ score: number }> = ({ score }) => {
  if (score < -2.0) {
    return (
      <>
        <DownArrow />
        <DownArrow />
        <DownArrow />
      </>
    )
  } else if (score < -0.5) {
    return (
      <>
        <DownArrow />
        <DownArrow />
      </>
    )
  } else if (score < 0.0) {
    return (
      <>
        <DownArrow />
      </>
    )
  } else if (score <= 0.5) {
    return (
      <>
        <UpArrow />
      </>
    )
  } else if (score <= 2.0) {
    return (
      <>
        <UpArrow />
        <UpArrow />
      </>
    )
  } else {
    return (
      <>
        <UpArrow />
        <UpArrow />
        <UpArrow />
      </>
    )
  }
}

// Do adjust margins for CellRenders when using these fields
const FieldsWithNegativeMargin = [
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
]

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

export const ExplanationBox: React.FC<{
  $p: number
  $why: Why
  tableColumnMap: TableColumnMap
  linkedTables: FieldMap
  fields: Field[]
  limit?: number
}> = ({ $p, $why, tableColumnMap, fields, linkedTables, limit = 5 }) => {
  if (!$why) {
    return <React.Fragment />
  }
  const explanation = simpleExplanation($p, $why)

  const sortByAbsScore = (a: SimpleExplanation, b: SimpleExplanation) => Math.abs(b.score) - Math.abs(a.score)

  const propositionLifts = explanation.filter((e): e is RelatedExplanation => e.type === 'relatedPropositionLift')
  propositionLifts.sort(sortByAbsScore)
  const sortedExplanations = Number.isFinite(limit) ? _.take(propositionLifts, limit) : propositionLifts

  const droppedComponentCount = propositionLifts.length - sortedExplanations.length

  // Check which description fields are needed
  const linkExplanationFieldIds = sortedExplanations.reduce(
    (acc, { propositions }) => [
      ...acc,
      ...propositions
        .filter(
          ([fieldId]) =>
            acc.indexOf(fieldId) < 0 &&
            fields.find((field) => field.id === fieldId)?.type === FieldType.MULTIPLE_RECORD_LINKS,
        )
        .map(([fieldId]) => fieldId),
    ],
    [] as string[],
  )

  const linkExplanationTables = linkExplanationFieldIds
    .map((fieldId) => {
      const link = linkedTables[fieldId]
      if (link) {
        const [, query] = link
        return [fieldId, query]
      }
    })
    .filter((x): x is [string, TableOrViewQueryResult] => Boolean(x))
  const loadables = linkExplanationTables.map((v) => v[1])
  useLoadable(loadables)

  // Fetch records that are refrenced from somewhere
  const linkedRecords = sortedExplanations.reduce(
    (acc, { propositions }) => [
      ...acc,
      ...propositions
        .map(([fieldId, proposition]) => {
          const field = fields.find((field) => field.id === fieldId)
          if (!field) return
          if (field.type !== FieldType.MULTIPLE_RECORD_LINKS) return
          if (isIsProposition(proposition)) {
            const recordId = proposition.$is as string
            return [fieldId, recordId]
          } else if (isHasProposition(proposition)) {
            const recordId = proposition.$has as string
            return [fieldId, recordId]
          }
        })
        .filter((v): v is [string, string] =>
          Boolean(v && !acc.find((value) => value[0] === v[0] && value[1] === v[1])),
        ),
    ],
    [] as [string, string][],
  )

  const recordsByField = linkedRecords.reduce((acc, [fieldId, recordId]) => {
    const [, tableQuery] = linkExplanationTables.find(([fId]) => fId === fieldId) || []
    if (tableQuery) {
      const list = acc[fieldId] || []
      const record = tableQuery.getRecordByIdIfExists(recordId)
      if (record) {
        return {
          ...acc,
          [fieldId]: [...list, record],
        }
      }
    }
    return acc
  }, {} as globalThis.Record<string, Record[]>)

  const allRecords = Object.values(recordsByField).reduce<Record[]>((acc, list) => [...acc, ...list], [])
  useWatchable(allRecords, 'name')

  const descriptions = sortedExplanations.map(({ score, propositions }, i) => {
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
        convert = (x) => conversion.toCellValue(x, field.config)
      }
      if (field.type === FieldType.MULTIPLE_RECORD_LINKS) {
        convert = (feature) => {
          const id = String(feature)
          const records: Record[] = recordsByField[field.id] || []
          const name: string | undefined = records.find((rec) => rec.id === id)?.name
          return [{ id, name }]
        }
      }

      const negativeMargin = FieldsWithNegativeMargin.indexOf(field.type) >= 0 ? '-6px' : '0'

      const fieldHeader = (
        <Text textColor="white">
          <FieldIcon field={field} style={{ verticalAlign: 'text-bottom' }} marginRight={1} />
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
          <ArrowScore score={score} />
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

export const MatchExplanationBox: React.FC<{
  $p: number
  $why: Why
  hitFields: Field[]
  contextFields: Field[]
  limit?: number
}> = ({ $p, $why, hitFields, contextFields, limit = 5 }) => {
  if (!$why) {
    return <React.Fragment />
  }

  const explanation = matchExplanation($p, $why)

  const sortByAbsScore = (a: MatchExplanation, b: MatchExplanation) => Math.abs(b.score) - Math.abs(a.score)

  const propositionLifts = explanation.filter(
    (e): e is HitExplanation => e.type === 'hitPropositionLift' && e.hitFieldId !== 'id',
  )
  propositionLifts.sort(sortByAbsScore)
  const sortedExplanations = Number.isFinite(limit) ? _.take(propositionLifts, limit) : propositionLifts

  const droppedComponentCount = propositionLifts.length - sortedExplanations.length

  const descriptions = sortedExplanations.map(({ score, hitFieldId, contextFieldIds }, i) => {
    const fieldId = hitFieldId
    const field = hitFields.find((f) => f.id === fieldId)
    if (!field) {
      console.warn('field not found', hitFieldId)
      return null
    }

    const fieldHeader = (
      <Text textColor="white">
        {score >= 0 ? 'Match' : 'Mismatch'} in <InlineFieldIcon field={field} />
        <b>{field.name}</b> and
        {contextFieldIds.map((contextFieldId, i) => {
          const contextField = contextFields.find((f) => f.id === contextFieldId)
          if (!contextField) {
            return null
          }
          if (i > 2) {
            return null
          }
          const remaining = contextFieldIds.length - i - 1
          if (i === 2 && remaining > 1) {
            return (
              <Box key={i} paddingTop={1}>
                and {remaining} more fields
              </Box>
            )
          }
          return (
            <Box key={i} paddingTop={1}>
              <InlineFieldIcon field={contextField} />
              <b>{contextField.name}</b>
            </Box>
          )
        })}
      </Text>
    )

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
          <ArrowScore score={score} />
        </Box>
        <Box
          display="flex"
          flexDirection="row"
          flexWrap="wrap"
          flexGrow={1}
          style={{ gap: '6px', borderTop: i > 0 ? '1px solid gray' : undefined }}
          paddingTop={1}
        >
          {fieldHeader}
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
