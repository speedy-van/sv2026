import {
  MailAttachmentResponseSchema,
  MailDeliveriesResponseSchema,
  MailListResponseSchema,
  MailOkResponseSchema,
  MailQueuedResponseSchema,
  MailReplyRequestSchema,
  MailStatusResponseSchema,
  MailThreadResponseSchema,
  type MailFolder,
  type MailReplyRequest,
} from '@sv/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type InfiniteData,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { z } from 'zod';
import { useAdminToolSession, type AdminToolSession } from './admin-tool-session';

export type MailAttachmentContent = z.infer<typeof MailAttachmentResponseSchema>;
type MailStatus = z.infer<typeof MailStatusResponseSchema>;
type MailQueued = z.infer<typeof MailQueuedResponseSchema>;
interface MailInboxData {
  session: AdminToolSession;
  status: UseQueryResult<MailStatus>;
  query: UseInfiniteQueryResult<InfiniteData<z.infer<typeof MailListResponseSchema>>>;
  sync: UseMutationResult<MailStatus, Error, void>;
}
interface MailThreadData {
  session: AdminToolSession;
  status: UseQueryResult<MailStatus>;
  query: UseInfiniteQueryResult<InfiniteData<z.infer<typeof MailThreadResponseSchema>>>;
  read: UseMutationResult<z.infer<typeof MailOkResponseSchema>, Error, { id: string; read: boolean }>;
  reply: UseMutationResult<MailQueued, Error, { id: string; reply: MailReplyRequest }>;
  attachment: UseMutationResult<MailAttachmentContent, Error, { messageId: string; attachmentId: string }>;
}
interface MailDeliveriesData {
  session: AdminToolSession;
  query: UseInfiniteQueryResult<InfiniteData<z.infer<typeof MailDeliveriesResponseSchema>>>;
  retry: UseMutationResult<MailQueued, Error, { id: string; acknowledgeDuplicateRisk: boolean }>;
}
const base = '/api/v1/admin/mail';

function pageQuery(cursor: string | null): string {
  return new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) }).toString();
}

export function useMailStatus(session: AdminToolSession): UseQueryResult<MailStatus> {
  return useQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'mail', 'status'],
    queryFn: ({ signal }) => session.request(`${base}/status`, MailStatusResponseSchema, { signal }),
    refetchInterval: session.enabled ? 30_000 : false,
  });
}

export function useMailInbox(folder: MailFolder, search: string): MailInboxData {
  const session = useAdminToolSession();
  const status = useMailStatus(session);
  const client = useQueryClient();
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'mail', 'messages', folder, search],
    enabled: session.enabled && status.data?.configured === true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(
        `${base}/messages?${pageQuery(pageParam)}&${new URLSearchParams({ folder, ...(search ? { q: search } : {}) }).toString()}`,
        MailListResponseSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: session.enabled ? 30_000 : false,
  });
  const sync = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: () =>
      session.request(`${base}/sync`, MailStatusResponseSchema, { method: 'POST', body: { folder } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin', session.actorId, 'mail'] });
    },
  });
  return { session, status, query, sync };
}

export function useMailThread(id: string): MailThreadData {
  const session = useAdminToolSession();
  const status = useMailStatus(session);
  const client = useQueryClient();
  const invalidate = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['admin', session.actorId, 'mail'] });
  };
  const query = useInfiniteQuery({
    ...session.queryOptions,
    enabled: session.enabled && Boolean(id),
    queryKey: ['admin', session.actorId, 'mail', 'thread', id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(
        `${base}/threads/${encodeURIComponent(id)}?${pageQuery(pageParam)}`,
        MailThreadResponseSchema,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: session.enabled ? 30_000 : false,
  });
  const read = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: { id: string; read: boolean }) =>
      session.request(`${base}/messages/${encodeURIComponent(input.id)}/read`, MailOkResponseSchema, {
        method: 'POST',
        body: { read: input.read },
      }),
    onSuccess: invalidate,
  });
  const reply = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: { id: string; reply: MailReplyRequest }) =>
      session.request(`${base}/messages/${encodeURIComponent(input.id)}/reply`, MailQueuedResponseSchema, {
        method: 'POST',
        body: MailReplyRequestSchema.parse(input.reply),
      }),
    onSuccess: invalidate,
  });
  const attachment = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: { messageId: string; attachmentId: string }) =>
      session.request(
        `${base}/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(input.attachmentId)}`,
        MailAttachmentResponseSchema,
      ),
  });
  return { session, status, query, read, reply, attachment };
}

export function useMailDeliveries(): MailDeliveriesData {
  const session = useAdminToolSession();
  const client = useQueryClient();
  const query = useInfiniteQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'mail', 'deliveries'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      session.request(`${base}/deliveries?${pageQuery(pageParam)}`, MailDeliveriesResponseSchema, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: session.enabled ? 15_000 : false,
  });
  const retry = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: { id: string; acknowledgeDuplicateRisk: boolean }) =>
      session.request(`${base}/deliveries/${encodeURIComponent(input.id)}/retry`, MailQueuedResponseSchema, {
        method: 'POST',
        body: { acknowledgeDuplicateRisk: input.acknowledgeDuplicateRisk },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin', session.actorId, 'mail'] });
    },
  });
  return { session, query, retry };
}
