import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@sv/contracts';
import { ChatSoundArrivals } from '../src/components/live-chat/sound-arrivals';

function message(id: string, sender: ChatMessage['sender'] = 'ADMIN'): ChatMessage {
  return {
    id, sender, body: 'Notification test',
    clientMessageId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-10-15T18:00:00.000Z',
  };
}

describe('incoming customer chat sound', () => {
  it('silences the initial saved conversation, own sends and repeated pages', () => {
    const arrivals = new ChatSoundArrivals();
    expect(arrivals.observe('saved', [message('old')], false)).toBe(false);
    expect(arrivals.observe('saved', [message('mine', 'CUSTOMER')], false)).toBe(false);
    expect(arrivals.observe('saved', [message('reply')], false)).toBe(true);
    expect(arrivals.observe('saved', [message('reply')], false)).toBe(false);
    expect(arrivals.observe('saved', [], false)).toBe(false);
  });

  it('rings for the first admin reply in a newly started empty thread', () => {
    const arrivals = new ChatSoundArrivals();
    arrivals.setConversation('new');
    expect(arrivals.observe('new', [], false)).toBe(false);
    arrivals.setConversation('new');
    expect(arrivals.observe('new', [message('mine', 'CUSTOMER'), message('first-reply')], false)).toBe(true);
  });

  it('treats all resumed backlog pages as a silent baseline', () => {
    const arrivals = new ChatSoundArrivals();
    arrivals.observe('saved', [message('old')], false);
    arrivals.suspend();
    expect(arrivals.observe('saved', [message('backlog-one')], true)).toBe(false);
    expect(arrivals.observe('saved', [message('backlog-two')], false)).toBe(false);
    expect(arrivals.observe('saved', [message('live')], false)).toBe(true);
  });

  it('does not replay late responses or reset the same thread on reopen/read updates', () => {
    const arrivals = new ChatSoundArrivals();
    arrivals.observe('saved', [], false);
    expect(arrivals.observe('saved', [message('late')], false, true)).toBe(false);
    arrivals.setConversation('saved');
    expect(arrivals.observe('saved', [message('late')], false)).toBe(false);
    expect(arrivals.observe('saved', [message('live')], false)).toBe(true);
  });

  it('resets deduplication and baseline when a cookie expires or changes thread', () => {
    const arrivals = new ChatSoundArrivals();
    arrivals.setConversation('one');
    arrivals.observe('one', [], false);
    expect(arrivals.observe('one', [message('same-id')], false)).toBe(true);
    arrivals.setConversation(null);
    expect(arrivals.observe('two', [message('same-id')], false)).toBe(false);
    expect(arrivals.observe('two', [message('new-id')], false)).toBe(true);
  });

  it('coalesces several genuinely new incoming messages into one cue', () => {
    const arrivals = new ChatSoundArrivals();
    arrivals.observe('saved', [], false);
    expect(arrivals.observe('saved', [message('one'), message('two'), message('three')], false)).toBe(true);
    expect(arrivals.observe('saved', [message('one'), message('two'), message('three')], false)).toBe(false);
  });
});
