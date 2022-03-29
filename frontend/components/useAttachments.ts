import { Field, FieldType, Table } from '@airtable/blocks/models'
import { useRecords } from '@airtable/blocks/ui'
import { isArrayOf, isObjectOf, isString } from '../validator/validation'

const isAttachmentsLike = isArrayOf(isObjectOf({ id: isString }))

export type FieldId = Field['id']

export type AttachmentMap = Record<string, unknown>

const useAttachments = (table: Table, fields: Field[]): AttachmentMap => {
  const isMultipleAttachment = (f: Field): boolean => f.type === FieldType.MULTIPLE_ATTACHMENTS
  const needsAttachments = fields.filter(isMultipleAttachment).length > 0
  const attachmentFields = table.fields.filter(isMultipleAttachment)

  // Only fetch records if we need to
  const records = useRecords(needsAttachments ? table : (null as any), { fields: attachmentFields }) || []
  const result: AttachmentMap = {}

  records.forEach((rec) => {
    attachmentFields.forEach((field) => {
      try {
        const attachments = rec.getCellValue(field) as Array<{ id: string }>
        attachments.forEach((a) => {
          if (!(a.id in result)) {
            result[a.id] = a
          }
        })
      } catch (e) {
        // Ignore
      }
    })
  })

  return result
}

export const getAttachments = (attachmentMap: AttachmentMap, feature: unknown): unknown[] => {
  if (isAttachmentsLike(feature)) {
    return feature.map(({ id }) => attachmentMap[id]).filter(Boolean)
  }
  return []
}

export default useAttachments
