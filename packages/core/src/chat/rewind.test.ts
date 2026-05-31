import { describe, expect, it } from 'vitest';
import { planRewind } from './rewind.js';
import type { Conversation } from './types.js';

function conversation(over?: Partial<Conversation>): Conversation {
  return {
    id: 'c1',
    title: 't',
    messages: [
      { id: 'm1', role: 'user', content: 'a', at: '1', turnIndex: 0 },
      { id: 'm2', role: 'assistant', content: 'b', at: '2', turnIndex: 1 },
      { id: 'm3', role: 'user', content: 'c', at: '3', turnIndex: 2 },
      { id: 'm4', role: 'assistant', content: 'd', at: '4', turnIndex: 3 },
    ],
    checkpoints: [
      {
        id: 'cp1',
        phase: 'implement',
        turnIndex: 2,
        changedFiles: ['x.ts'],
        workState: { phase: 'implement' },
        at: '3',
      },
    ],
    createdAt: '0',
    updatedAt: '4',
    ...over,
  };
}

describe('planRewind', () => {
  it('returns undefined for an unknown checkpoint id', () => {
    expect(planRewind(conversation(), 'nope')).toBeUndefined();
  });

  it('splits messages at the checkpoint turn index and carries the file manifest', () => {
    const plan = planRewind(conversation(), 'cp1');
    expect(plan?.targetTurnIndex).toBe(2);
    expect(plan?.messagesToKeep.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(plan?.messagesToDrop.map((m) => m.id)).toEqual(['m3', 'm4']);
    expect(plan?.changedFiles).toEqual(['x.ts']);
    expect(plan?.workState).toEqual({ phase: 'implement' });
    expect(plan?.warnings).toEqual([]);
  });

  it('does not mutate the source conversation', () => {
    const conv = conversation();
    planRewind(conv, 'cp1');
    expect(conv.messages).toHaveLength(4);
  });

  it('warns and clamps when the checkpoint turn index exceeds the message count', () => {
    const conv = conversation({
      checkpoints: [{ id: 'cp1', turnIndex: 99, changedFiles: ['x.ts'], at: '3', workState: {} }],
    });
    const plan = planRewind(conv, 'cp1');
    expect(plan?.targetTurnIndex).toBe(4);
    expect(plan?.warnings.some((w) => w.includes('exceeds'))).toBe(true);
  });

  it('warns when there is no file manifest or work-state snapshot', () => {
    const conv = conversation({
      checkpoints: [{ id: 'cp1', turnIndex: 1, changedFiles: [], at: '2' }],
    });
    const plan = planRewind(conv, 'cp1');
    expect(plan?.warnings.some((w) => w.includes('no changed-file manifest'))).toBe(true);
    expect(plan?.warnings.some((w) => w.includes('no agent-loop state'))).toBe(true);
  });
});
