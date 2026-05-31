import type { Conversation, RewindPlan } from './types.js';

/**
 * Plan a rewind to a checkpoint (T-1303). Pure and **non-mutating**: it
 * describes what the IDE should do, it does not do it. The IDE restores the
 * conversation view from `messagesToKeep` and, using its own VCS / undo-buffer
 * authority, restores `changedFiles` — core has no file-write authority for a
 * rewind (council: "AgentDriver decides when, CheckpointStore records what,
 * the IDE decides how to restore files").
 *
 * Returns `undefined` when the checkpoint id is unknown (a clear signal to the
 * caller). Soft problems (a checkpoint with no file manifest, a `turnIndex`
 * past the current message count) are surfaced in `warnings`, never thrown.
 */
export function planRewind(
  conversation: Conversation,
  checkpointId: string,
): RewindPlan | undefined {
  const checkpoint = conversation.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) return undefined;

  const warnings: string[] = [];
  const total = conversation.messages.length;

  let targetTurnIndex = checkpoint.turnIndex;
  if (targetTurnIndex > total) {
    warnings.push(
      `Checkpoint turnIndex ${targetTurnIndex} exceeds the ${total} message(s) on record; clamping to ${total}.`,
    );
    targetTurnIndex = total;
  }

  if (checkpoint.changedFiles.length === 0) {
    warnings.push('Checkpoint has no changed-file manifest; only the conversation will rewind.');
  }
  if (checkpoint.workState === undefined) {
    warnings.push('Checkpoint has no agent-loop state snapshot; the run cannot resume mid-phase.');
  }

  return {
    conversationId: conversation.id,
    checkpointId,
    targetTurnIndex,
    messagesToKeep: conversation.messages.slice(0, targetTurnIndex),
    messagesToDrop: conversation.messages.slice(targetTurnIndex),
    changedFiles: checkpoint.changedFiles,
    workState: checkpoint.workState,
    warnings,
  };
}
