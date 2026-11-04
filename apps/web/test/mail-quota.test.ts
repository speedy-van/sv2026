import { createHash } from 'node:crypto';
import type { DbTx } from '@sv/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ env: vi.fn(), usageDay: vi.fn(), usageRecipients: vi.fn() }));
vi.mock('../src/server/env', () => ({ serverEnv: mocks.env }));
vi.mock('@sv/db', () => ({ prisma: {
  mailQuotaDay: { findUnique: mocks.usageDay }, mailQuotaRecipient: { count: mocks.usageRecipients },
} }));
import { externalRecipients, nextQuotaReset, quotaScopes, quotaUsage, reserveQuota, uniqueRecipients } from '../src/server/mail/quota';
import { MailDeferredError, MailPermanentError } from '../src/server/mail/errors';

const now = new Date('2031-07-01T12:00:00.000Z');
const mailbox = 'support@example.test';
const day = '2031-07-01';
const limits = {
  LARK_MAIL_DAILY_MESSAGES: 300, LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: 150,
  LARK_MAIL_ORG_DAILY_MESSAGES: 400, LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: 400,
  LARK_MAIL_MIN_SEND_INTERVAL_SECONDS: 3,
};
type QuotaDay = { id: string; messages: number; updatedAt: Date };
type QuotaRecipient = { scope: string; day: string; hash: string };
type State = { days: Map<string, QuotaDay>; recipients: QuotaRecipient[] };
function recipient(scope: string, address: string, quotaDay = day): QuotaRecipient {
  return { scope, day: quotaDay, hash: createHash('sha256').update(`${scope}:${quotaDay}:${address}`).digest('hex') };
}

/** In-memory transaction/lock harness, not proof of real PostgreSQL behavior. */
function store() {
  let committed: State = { days: new Map(), recipients: [] };
  let lockTail = Promise.resolve();
  const lockSql: string[] = [];
  const operations: string[] = [];
  return {
    lockSql, operations,
    state: () => committed,
    seedDay(scope: string, messages: number, updatedAt = new Date(now.getTime() - 10_000)) {
      const id = `${scope}:${day}`;
      committed.days.set(id, { id, messages, updatedAt });
    },
    seedRecipient(scope: string, address: string) { committed.recipients.push(recipient(scope, address)); },
    async transaction(run: (tx: DbTx) => Promise<void>, updatedAt = now): Promise<void> {
      let staged: State | undefined;
      let release: (() => void) | undefined;
      function state(): State {
        if (!staged) throw new Error('Quota data was accessed before acquiring the advisory lock.');
        return staged;
      }
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray): Promise<number> => {
          const sql = strings.join('?');
          lockSql.push(sql);
          if (!sql.includes("pg_advisory_xact_lock(hashtext('lark-mail-quota'))")) throw new Error('Expected shared quota lock.');
          const previous = lockTail;
          const current = new Promise<void>((resolve) => { release = resolve; });
          lockTail = previous.then(() => current);
          await previous;
          operations.push('lock');
          staged = { days: new Map([...committed.days].map(([id, row]) => [id, { ...row }])), recipients: committed.recipients.map((row) => ({ ...row })) };
          return 1;
        },
        mailQuotaDay: {
          findUnique: ({ where }: { where: { id: string } }): Promise<QuotaDay | null> => {
            operations.push('read-day');
            return Promise.resolve(state().days.get(where.id) ?? null);
          },
          upsert: ({ where, create, update }: {
            where: { id: string }; create: { id: string; messages: number }; update: { messages: { increment: number } };
          }): Promise<QuotaDay> => {
            const current = state().days.get(where.id);
            const row = { id: where.id, messages: current ? current.messages + update.messages.increment : create.messages, updatedAt };
            state().days.set(row.id, row);
            operations.push('write-day');
            return Promise.resolve(row);
          },
        },
        mailQuotaRecipient: {
          findMany: ({ where }: { where: { scope: string; day: string } }): Promise<{ hash: string }[]> => {
            operations.push('read-recipients');
            return Promise.resolve(state().recipients.filter((row) => row.scope === where.scope && row.day === where.day).map(({ hash }) => ({ hash })));
          },
          createMany: ({ data, skipDuplicates }: { data: QuotaRecipient[]; skipDuplicates: boolean }): Promise<{ count: number }> => {
            if (!skipDuplicates) throw new Error('Recipient writes must tolerate repeated normalized recipients.');
            let count = 0;
            for (const entry of data) {
              if (!state().recipients.some((row) => row.scope === entry.scope && row.day === entry.day && row.hash === entry.hash)) {
                state().recipients.push(entry); count += 1;
              }
            }
            operations.push('write-recipients');
            return Promise.resolve({ count });
          },
        },
      };
      try {
        await run(tx as unknown as DbTx);
        committed = state();
        operations.push('commit');
      } catch (error) {
        operations.push('rollback');
        throw error;
      } finally { release?.(); }
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue(limits);
});

describe('recipient normalization and provider day', () => {
  it('counts each normalized To/Cc/Bcc recipient only once', () => {
    expect(uniqueRecipients([' Customer@Outside.test ', 'local@example.test'], ['customer@outside.test'], ['LOCAL@EXAMPLE.TEST', 'other@outside.test']))
      .toEqual(['customer@outside.test', 'local@example.test', 'other@outside.test']);
  });
  it.each([
    { addresses: [] }, { addresses: ['invalid'] },
    { addresses: ['a@example.test\r\nBcc: b@example.test'] }, { addresses: ['a\0@example.test'] },
  ])('rejects invalid recipient input $addresses', ({ addresses }) => {
    expect(() => uniqueRecipients(addresses)).toThrow(MailPermanentError);
  });
  it('allows fifty unique recipients but rejects fifty-one', () => {
    const addresses = Array.from({ length: 51 }, (_, index) => `person${String(index)}@outside.test`);
    expect(uniqueRecipients(addresses.slice(0, 50))).toHaveLength(50);
    expect(() => uniqueRecipients(addresses)).toThrow(MailPermanentError);
  });
  it('treats only the exact mailbox domain as internal', () => {
    expect(externalRecipients(['worker@EXAMPLE.TEST', 'a@sub.example.test', 'b@notexample.test', 'a@SUB.EXAMPLE.TEST'], mailbox))
      .toEqual(['a@sub.example.test', 'b@notexample.test']);
  });
  it.each([
    ['2031-07-01T22:30:00.000Z', '2031-07-02T00:00:01.000Z'],
    ['2031-07-01T23:59:59.999Z', '2031-07-02T00:00:01.000Z'],
    ['2031-12-31T23:59:59.999Z', '2032-01-01T00:00:01.000Z'],
    ['2032-02-29T10:00:00.000Z', '2032-03-01T00:00:01.000Z'],
  ])('resets on the next UTC day for %s', (value, expected) => {
    expect(nextQuotaReset(new Date(value)).toISOString()).toBe(expected);
  });
});

describe('persistent quota reservation through a transaction harness', () => {
  it('reserves one message per scope and stores daily hashes only for unique external recipients', async () => {
    const database = store();
    await database.transaction((tx) => reserveQuota(tx, mailbox, uniqueRecipients(
      ['Customer@Outside.test', 'worker@example.test'], ['customer@outside.test'], ['another@outside.test'],
    ), now));
    expect(database.operations[0]).toBe('lock');
    expect(database.lockSql).toHaveLength(1);
    expect(quotaScopes(mailbox)).toEqual([`mailbox:${mailbox}`, 'organization']);
    for (const scope of quotaScopes(mailbox)) {
      expect(database.state().days.get(`${scope}:${day}`)?.messages).toBe(1);
      expect(database.state().recipients.filter((row) => row.scope === scope)).toEqual([
        recipient(scope, 'customer@outside.test'), recipient(scope, 'another@outside.test'),
      ]);
    }
    expect(JSON.stringify(database.state().recipients)).not.toContain('customer@outside.test');
  });
  it('does not count an external address again below the threshold but still reserves the next message', async () => {
    const database = store();
    for (const scope of quotaScopes(mailbox)) { database.seedDay(scope, 1); database.seedRecipient(scope, 'known@outside.test'); }
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['known@outside.test'], now));
    expect(database.state().recipients).toHaveLength(2);
    expect([...database.state().days.values()].map((row) => row.messages)).toEqual([2, 2]);
  });
  it.each(['mailbox', 'organization'])('defers at the %s message cap without committing partial reservations', async (scope) => {
    const database = store();
    database.seedDay(scope === 'mailbox' ? `mailbox:${mailbox}` : 'organization', scope === 'mailbox' ? 300 : 400);
    const before = structuredClone(database.state());
    await expect(database.transaction((tx) => reserveQuota(tx, mailbox, ['a@outside.test'], now)))
      .rejects.toMatchObject({ code: 'MAIL_QUOTA_DEFERRED', retryAt: nextQuotaReset(now) });
    expect(database.state()).toEqual(before);
  });
  it.each(['mailbox', 'organization'])('rolls back when new recipients exceed the %s recipient cap', async (scope) => {
    mocks.env.mockReturnValue({ ...limits, LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: 2, LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: 2 });
    const database = store();
    const cappedScope = scope === 'mailbox' ? `mailbox:${mailbox}` : 'organization';
    database.seedRecipient(cappedScope, 'known@outside.test');
    const before = structuredClone(database.state());
    await expect(database.transaction((tx) => reserveQuota(tx, mailbox, ['new1@outside.test', 'new2@outside.test'], now))).rejects.toBeInstanceOf(MailDeferredError);
    expect(database.state()).toEqual(before);
    if (scope === 'organization') expect(database.operations).toContain('write-day');
    expect(database.operations.at(-1)).toBe('rollback');
  });
  it('permits reaching an external-recipient threshold exactly, then defers even repeats', async () => {
    mocks.env.mockReturnValue({ ...limits, LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: 2 });
    const database = store();
    database.seedRecipient(`mailbox:${mailbox}`, 'known@outside.test');
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['new@outside.test'], now));
    const later = new Date(now.getTime() + 10_000);
    await expect(database.transaction((tx) => reserveQuota(tx, mailbox, ['known@outside.test'], later), later))
      .rejects.toMatchObject({ code: 'MAIL_QUOTA_DEFERRED' });
    expect(database.state().days.get(`mailbox:${mailbox}:${day}`)?.messages).toBe(1);
  });
  it('still counts internal-only messages without consuming external-recipient capacity', async () => {
    mocks.env.mockReturnValue({ ...limits, LARK_MAIL_DAILY_EXTERNAL_RECIPIENTS: 1, LARK_MAIL_ORG_DAILY_EXTERNAL_RECIPIENTS: 1 });
    const database = store();
    for (const scope of quotaScopes(mailbox)) database.seedRecipient(scope, 'known@outside.test');
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['team@example.test'], now));
    expect(database.state().recipients).toHaveLength(2);
    expect([...database.state().days.values()].map((row) => row.messages)).toEqual([1, 1]);
  });
  it('paces consecutive sends and resumes precisely at the allowed time', async () => {
    const database = store();
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['a@outside.test'], now));
    const retryAt = new Date(now.getTime() + 3_000);
    await expect(database.transaction((tx) => reserveQuota(tx, mailbox, ['b@outside.test'], now)))
      .rejects.toMatchObject({ code: 'MAIL_SEND_PACED', retryAt });
    expect(database.state().days.get(`mailbox:${mailbox}:${day}`)?.messages).toBe(1);
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['b@outside.test'], retryAt), retryAt);
    expect(database.state().days.get(`mailbox:${mailbox}:${day}`)?.messages).toBe(2);
  });
  it('rolls back a mailbox reservation when organization pacing delays it', async () => {
    const database = store();
    database.seedDay('organization', 1, new Date(now.getTime() - 1_000));
    const before = structuredClone(database.state());
    await expect(database.transaction((tx) => reserveQuota(tx, mailbox, ['a@outside.test'], now)))
      .rejects.toMatchObject({ code: 'MAIL_SEND_PACED', retryAt: new Date(now.getTime() + 2_000) });
    expect(database.state()).toEqual(before);
  });
  it('uses a new UTC date key after midnight without deleting earlier counters', async () => {
    const database = store();
    database.seedDay(`mailbox:${mailbox}`, 300); database.seedDay('organization', 400);
    const tomorrow = new Date('2031-07-02T00:00:00.000Z');
    await database.transaction((tx) => reserveQuota(tx, mailbox, ['a@outside.test'], tomorrow), tomorrow);
    expect(database.state().days.get(`mailbox:${mailbox}:${day}`)?.messages).toBe(300);
    expect(database.state().days.get(`mailbox:${mailbox}:2031-07-02`)?.messages).toBe(1);
  });
  it('uses the shared advisory-lock boundary to serialize competing last-slot reservations in the mock harness', async () => {
    mocks.env.mockReturnValue({ ...limits, LARK_MAIL_ORG_DAILY_MESSAGES: 1 });
    const database = store();
    const results = await Promise.allSettled([
      database.transaction((tx) => reserveQuota(tx, mailbox, ['a@outside.test'], now)),
      database.transaction((tx) => reserveQuota(tx, 'sales@example.test', ['b@outside.test'], now)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(MailDeferredError);
    expect(database.lockSql).toHaveLength(2);
    expect(database.lockSql[0]).toBe(database.lockSql[1]);
    expect(database.state().days.get(`organization:${day}`)?.messages).toBe(1);
    expect(database.state().days.has(`mailbox:sales@example.test:${day}`)).toBe(false);
  });
});

describe('reported mailbox usage', () => {
  it('reports configured limits and the next UTC reset without inferring provider usage', async () => {
    mocks.usageDay.mockResolvedValue({ messages: 12 }); mocks.usageRecipients.mockResolvedValue(8);
    await expect(quotaUsage(mailbox, now)).resolves.toEqual({
      messagesUsed: 12, messagesLimit: 300, externalRecipientsUsed: 8, externalRecipientsLimit: 150,
      resetsAt: '2031-07-02T00:00:01.000Z',
    });
    expect(mocks.usageDay).toHaveBeenCalledExactlyOnceWith({ where: { id: `mailbox:${mailbox}:${day}` } });
    expect(mocks.usageRecipients).toHaveBeenCalledExactlyOnceWith({ where: { scope: `mailbox:${mailbox}`, day } });
  });
  it('reports zero only when no stored usage row exists', async () => {
    mocks.usageDay.mockResolvedValue(null); mocks.usageRecipients.mockResolvedValue(0);
    expect(await quotaUsage(mailbox, now)).toMatchObject({ messagesUsed: 0, externalRecipientsUsed: 0 });
  });
});
