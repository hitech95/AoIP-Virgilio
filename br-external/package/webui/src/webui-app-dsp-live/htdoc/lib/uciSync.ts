/**
 * Shared policy types for the EQ/live pages: the pipeline stage
 * classification and the editable-slot schema as returned by the daemon
 * (get_pipeline / get_saved_filters). The live->uci mapping itself lives
 * in lib/liveToUci.ts.
 */

export type PipelineStageKind = 'free' | 'mixer' | 'locked' | 'editable'

export interface PipelineStage {
  index: number
  kind: PipelineStageKind
  label: string
  channels?: number
  filters?: number
  max_steps?: number
}

export interface EditableSlot {
  policy: string
  channels: number
  allow: string[]
  max_steps: number
  filters: Array<Record<string, any>>
}

export interface FiltersSchema {
  editable: Record<string, EditableSlot>
  locked: Record<string, string[]>
  user_gains: string[]
}
