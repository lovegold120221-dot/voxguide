import type { WhatsAppManager } from './whatsapp';

const ALL_PERMISSIONS = [
  'send_messages',
  'read_chats',
  'access_contacts',
  'manage_contacts',
  'access_groups',
  'send_group_messages',
  'read_group_chats',
  'view_message_history',
  'access_images',
  'access_videos',
  'access_audio',
  'access_documents',
  'access_stickers',
  'access_contact_cards',
  'access_location',
  'access_links',
  'access_polls',
] as const;

type Permission = typeof ALL_PERMISSIONS[number];
const HISTORY_RESPONSE_LIMIT = Math.max(50, Math.min(Number(process.env.WA_HISTORY_RESPONSE_LIMIT) || 2_000, 10_000));

const WHATSAPP_TOOL_ALIASES: Record<string, string> = {
  chats: 'readChats',
  listchats: 'readChats',
  list_chats: 'readChats',
  read_chats: 'readChats',
  readchats: 'readChats',
  contacts: 'getContacts',
  listcontacts: 'getContacts',
  list_contacts: 'getContacts',
  readcontacts: 'getContacts',
  groups: 'getGroups',
  listgroups: 'getGroups',
  list_groups: 'getGroups',
  history: 'getMessageHistory',
  messages: 'getMessageHistory',
  readmessages: 'getMessageHistory',
  read_messages: 'getMessageHistory',
  messagehistory: 'getMessageHistory',
  message_history: 'getMessageHistory',
  getchathistory: 'getMessageHistory',
  get_chat_history: 'getMessageHistory',
  calls: 'getCalls',
  callhistory: 'getCalls',
  call_history: 'getCalls',
  listcalls: 'getCalls',
  send: 'sendMessage',
  sendchat: 'sendMessage',
  send_chat: 'sendMessage',
  sendtext: 'sendMessage',
  send_text: 'sendMessage',
  sendtextmessage: 'sendMessage',
  send_text_message: 'sendMessage',
  sendgroup: 'sendGroupMessage',
  send_group: 'sendGroupMessage',
  sendgroupmessage: 'sendGroupMessage',
  send_group_message: 'sendGroupMessage',
  sendphoto: 'sendImage',
  send_photo: 'sendImage',
  senddocument: 'sendFile',
  send_document: 'sendFile',
  sendmedia: 'sendMedia',
  send_media: 'sendMedia',
  sendaudio: 'sendAudio',
  send_audio: 'sendAudio',
  voicenote: 'sendAudio',
  voice_note: 'sendAudio',
  react: 'sendReaction',
  reaction: 'sendReaction',
  send_reaction: 'sendReaction',
  sendbuttons: 'sendButtons',
  send_buttons: 'sendButtons',
  groupinfo: 'groupMetadata',
  group_info: 'groupMetadata',
  groupmetadata: 'groupMetadata',
  group_metadata: 'groupMetadata',
  getgroupmetadata: 'groupMetadata',
  get_group_metadata: 'groupMetadata',
  status: 'getStatus',
  get_status: 'getStatus',
  businessprofile: 'getBusinessProfile',
  business_profile: 'getBusinessProfile',
  get_business_profile: 'getBusinessProfile',
  getownbusinessprofile: 'getCloudBusinessProfile',
  get_own_business_profile: 'getCloudBusinessProfile',
  getcloudbusinessprofile: 'getCloudBusinessProfile',
  get_cloud_business_profile: 'getCloudBusinessProfile',
  updateownbusinessprofile: 'updateCloudBusinessProfile',
  update_own_business_profile: 'updateCloudBusinessProfile',
  updatecloudbusinessprofile: 'updateCloudBusinessProfile',
  update_cloud_business_profile: 'updateCloudBusinessProfile',
  changecloudavatar: 'updateCloudBusinessAvatar',
  change_cloud_avatar: 'updateCloudBusinessAvatar',
  updatecloudbusinessavatar: 'updateCloudBusinessAvatar',
  update_cloud_business_avatar: 'updateCloudBusinessAvatar',
  profilephoto: 'avatar',
  profile_photo: 'avatar',
  checkuser: 'userCheck',
  user_check: 'userCheck',
  whatsappusercheck: 'userCheck',
  markread: 'markAsRead',
  mark_read: 'markAsRead',
  markasread: 'markAsRead',
  markunread: 'markAsUnread',
  mark_unread: 'markAsUnread',
  markasunread: 'markAsUnread',
  archive: 'archiveChat',
  unarchive: 'unarchiveChat',
  mute: 'muteChat',
  unmute: 'unmuteChat',
  pin: 'pinChat',
  star: 'starMessage',
  unstar: 'unstarMessage',
  block: 'blockContact',
  unblock: 'unblockContact',
  sendcontact: 'sendContact',
  send_contact: 'sendContact',
  sendlocation: 'sendLocation',
  send_location: 'sendLocation',
  resolvecontact: 'resolveContact',
  resolve_contact: 'resolveContact',
  findcontact: 'resolveContact',
  sendcontactcard: 'sendContactCard',
  send_contact_card: 'sendContactCard',
  sharecontact: 'sendContactCard',
  sendtemplate: 'sendTemplate',
  send_template: 'sendTemplate',
};

const READ_ONLY_TOOLS = new Set([
  'readChats',
  'getContacts',
  'getGroups',
  'getMessageHistory',
  'getCalls',
  'groupInfo',
  'userCheck',
  'businessProfile',
  'avatar',
  'groupMetadata',
  'getGroupInviteLink',
  'getStatus',
  'getBusinessProfile',
  'getCloudBusinessProfile',
  'resync',
  'syncFullHistory',
  'sync_full_history',
  'resolveContact',
]);

export function normalizeWhatsAppTool(tool: unknown): string {
  const raw = String(tool || '').trim();
  if (!raw) return '';
  const key = raw.replace(/[\s-]+/g, '_').toLowerCase();
  return WHATSAPP_TOOL_ALIASES[key] || raw;
}

export function withDefaultWhatsAppPermissions(permissions?: Record<string, any>): Record<string, any> {
  const defaults = ALL_PERMISSIONS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as Record<string, any>);
  const requestContext = permissions || {};
  return {
    ...defaults,
    ...requestContext,
    requireUserApproval: requestContext.requireUserApproval,
    approvedByUser: requestContext.approvedByUser,
    mode: requestContext.mode,
  };
}

export function isOutboundWhatsAppAction(tool: unknown): boolean {
  const normalized = normalizeWhatsAppTool(tool);
  return Boolean(normalized) && !READ_ONLY_TOOLS.has(normalized);
}

export function validateDelegatedWhatsAppSend(permissions: Record<string, any> | undefined): string | null {
  return requireDelegatedSendApproval(permissions);
}

export function getWhatsAppToolPermissionError(permissions: Record<string, any> | undefined, perm: Permission): string | null {
  return requirePerm(permissions, perm);
}

export function pickWhatsAppRecipient(params: any): string {
  return String(params?.to || params?.chatId || params?.contactId || params?.jid || params?.groupId || params?.number || params?.phoneNumber || params?.name || '').trim();
}

export function pickWhatsAppText(params: any): string {
  return String(params?.text || params?.message || params?.body || params?.caption || '').trim();
}

function requirePerm(permissions: Record<string, any> | undefined, perm: Permission): string | null {
  if (!permissions?.[perm]) {
    return `Permission denied: "${perm}" is not enabled. User must enable this toggle in settings.`;
  }
  return null;
}

function requireDelegatedSendApproval(permissions: Record<string, any> | undefined): string | null {
  if (permissions?.requireUserApproval !== true) {
    return 'Delegated WhatsApp sends require requireUserApproval=true.';
  }
  if (permissions?.approvedByUser !== true) {
    return 'Delegated WhatsApp send blocked: user approval is required before sending.';
  }
  if (permissions?.mode !== 'delegated_send') {
    return 'Delegated WhatsApp sends require mode="delegated_send".';
  }
  return null;
}

function cleanLimit(limit: unknown, fallback = 20, max = 50): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function requireText(value: unknown, label: string): string | null {
  const text = String(value || '').trim();
  if (!text) return `${label} required`;
  return null;
}

export async function handleWhatsAppAction(
  wa: WhatsAppManager,
  userId: string,
  tool: string,
  params: any,
  permissions: Record<string, any> | undefined
): Promise<any> {
  tool = normalizeWhatsAppTool(tool);
  params = params || {};
  const effectivePermissions = wa.getEffectivePermissions(userId, permissions);
  const approvalDenied = isOutboundWhatsAppAction(tool) ? requireDelegatedSendApproval(effectivePermissions) : null;
  if (approvalDenied) return { ok: false, error: approvalDenied };

  try {
    switch (tool) {
      // ─── READING ───────────────────────────────────────────────────
      case 'readChats':
        return handleReadChats(wa, userId, effectivePermissions, params.limit);
      case 'getContacts':
        return handleGetContacts(wa, userId, effectivePermissions);
      case 'getGroups':
        return handleGetGroups(wa, userId, effectivePermissions);
      case 'getMessageHistory':
        return handleGetMessageHistory(wa, userId, effectivePermissions, pickWhatsAppRecipient(params), params.limit);
      case 'getCalls':
        return handleGetCalls(wa, userId, effectivePermissions, params.limit);
      case 'groupInfo':
        return { ok: true, info: await wa.getGroups(userId) };
      case 'groupMetadata':
        return { ok: true, metadata: await wa.getWhatsAppGroupMetadata(userId, pickWhatsAppRecipient(params)) };
      case 'getGroupInviteLink':
        return { ok: true, link: await wa.getWhatsAppGroupInviteLink(userId, pickWhatsAppRecipient(params)) };
      case 'userCheck':
        return { ok: true, result: await wa.checkWhatsAppUser(userId, params.number || params.to || params.phoneNumber) };
      case 'businessProfile':
      case 'getBusinessProfile':
        return { ok: true, profile: await wa.getWhatsAppBusinessProfile(userId, pickWhatsAppRecipient(params)) };
      case 'getOwnBusinessProfile':
      case 'getCloudBusinessProfile':
        return { ok: true, profile: await wa.getCloudBusinessProfile(userId) };
      case 'updateCloudBusinessProfile':
      case 'updateOwnBusinessProfile':
        return { ok: true, result: await wa.updateCloudBusinessProfile(userId, params) };
      case 'updateCloudBusinessAvatar':
      case 'changeCloudAvatar':
        return { ok: true, result: await wa.updateCloudBusinessAvatar(userId, params.mediaUrl || params.url) };
      case 'avatar':
        return { ok: true, url: await wa.getWhatsAppAvatar(userId, pickWhatsAppRecipient(params)) };

      case 'resolveContact':
        return { ok: true, result: await wa.resolveContact(userId, params.contactRef || params.name || params.query) };

      case 'sendContactCard':
        return { ok: true, result: await wa.sendWhatsAppContactCard(userId, pickWhatsAppRecipient(params), params.contactRef || params.contactId) };

      case 'sendTemplate':
        return { ok: true, result: await wa.sendWhatsAppTemplate(userId, pickWhatsAppRecipient(params), params.templateName, params.languageCode, params.components) };

      // ─── SENDING (REQUIRES APPROVAL) ───────────────────────────────
      case 'sendMessage':
      case 'sendGroupMessage':
      case 'sendImage':
      case 'sendFile':
      case 'sendVideo':
      case 'sendSticker':
      case 'sendMedia':
      case 'sendAudio':
        return handleSendMediaOrMessage(wa, userId, effectivePermissions, tool, params, tool === 'sendGroupMessage');

      case 'sendPoll':
        return { ok: true, result: await wa.sendWhatsAppPoll(userId, pickWhatsAppRecipient(params), pickWhatsAppText(params) || params.name, params.pollOptions || params.options || []) };

      case 'sendReaction':
        return { ok: true, result: await wa.sendWhatsAppReaction(userId, pickWhatsAppRecipient(params), params.messageId, params.emoji) };

      case 'sendButtons':
        return handleSendButtons(wa, userId, effectivePermissions, pickWhatsAppRecipient(params), pickWhatsAppText(params), params.buttons, params.footer);

      // ─── MODIFYING ─────────────────────────────────────────────────
      case 'deleteMessage':
      case 'revokeMessage':
        return { ok: true, result: await wa.deleteWhatsAppMessage(userId, pickWhatsAppRecipient(params), params.messageId, tool === 'revokeMessage') };

      case 'markAsRead':
        return { ok: true, result: await wa.markWhatsAppRead(userId, pickWhatsAppRecipient(params), params.messageId) };

      case 'pinChat':
        return { ok: true, result: await wa.pinWhatsAppChat(userId, pickWhatsAppRecipient(params), params.pin !== false) };

      case 'disappearingMessages':
        return { ok: true, result: await wa.setWhatsAppDisappearing(userId, pickWhatsAppRecipient(params), params.limit || params.duration || 0) };

      // ─── GROUPS ────────────────────────────────────────────────────
      case 'createGroup':
        return { ok: true, result: await wa.createWhatsAppGroup(userId, params.name || params.title, params.participants || []) };
      case 'joinGroup':
        return { ok: true, result: await wa.joinWhatsAppGroup(userId, params.code) };
      case 'manageParticipants':
        return { ok: true, result: await wa.updateWhatsAppGroupParticipants(userId, params.groupId || params.to, params.participants, (params.participantAction || params.memberAction || params.action) as any) };
      case 'setGroupName':
        return { ok: true, result: await wa.setWhatsAppGroupName(userId, params.groupId || params.to, params.name) };
      case 'setGroupTopic':
        return { ok: true, result: await wa.setWhatsAppGroupTopic(userId, params.groupId || params.to, params.text || params.topic) };

      // ─── FULL CRUD: Chats ──────────────────────────────────────────
      case 'archiveChat':
        return { ok: true, result: await wa.archiveWhatsAppChat(userId, pickWhatsAppRecipient(params), true) };
      case 'unarchiveChat':
        return { ok: true, result: await wa.archiveWhatsAppChat(userId, pickWhatsAppRecipient(params), false) };
      case 'muteChat':
        return { ok: true, result: await wa.muteWhatsAppChat(userId, pickWhatsAppRecipient(params), params.duration || 86400) };
      case 'unmuteChat':
        return { ok: true, result: await wa.muteWhatsAppChat(userId, pickWhatsAppRecipient(params), null) };
      case 'deleteChat':
        return { ok: true, result: await wa.deleteWhatsAppChat(userId, pickWhatsAppRecipient(params)) };
      case 'clearChat':
        return { ok: true, result: await wa.clearWhatsAppChat(userId, pickWhatsAppRecipient(params)) };
      case 'markAsUnread':
        return { ok: true, result: await wa.markWhatsAppUnread(userId, pickWhatsAppRecipient(params)) };

      // ─── FULL CRUD: Contacts ────────────────────────────────────────
      case 'blockContact':
        return { ok: true, result: await wa.blockWhatsAppContact(userId, pickWhatsAppRecipient(params), true) };
      case 'unblockContact':
        return { ok: true, result: await wa.blockWhatsAppContact(userId, pickWhatsAppRecipient(params), false) };
      case 'sendContact':
        return { ok: true, result: await wa.sendWhatsAppContact(userId, pickWhatsAppRecipient(params), params.contactName || params.name, params.phoneNumber || params.to) };

      // ─── FULL CRUD: Messages ────────────────────────────────────────
      case 'sendLocation':
        return { ok: true, result: await wa.sendWhatsAppLocation(userId, pickWhatsAppRecipient(params), params.latitude, params.longitude, params.name) };
      case 'starMessage':
        return { ok: true, result: await wa.starWhatsAppMessage(userId, pickWhatsAppRecipient(params), params.messageId, true) };
      case 'unstarMessage':
        return { ok: true, result: await wa.starWhatsAppMessage(userId, pickWhatsAppRecipient(params), params.messageId, false) };
      case 'forwardMessage':
        return handleSendMessage(wa, userId, effectivePermissions, pickWhatsAppRecipient(params), pickWhatsAppText(params), undefined, undefined, undefined);

      // ─── FULL CRUD: Groups ─────────────────────────────────────────
      case 'leaveGroup':
        return { ok: true, result: await wa.leaveWhatsAppGroup(userId, pickWhatsAppRecipient(params)) };
      case 'setGroupPhoto':
        return { ok: true, result: await wa.updateWhatsAppGroupPhoto(userId, pickWhatsAppRecipient(params), params.mediaUrl || params.url) };
      case 'removeGroupPhoto':
        return { ok: true, result: await wa.removeWhatsAppGroupPhoto(userId, pickWhatsAppRecipient(params)) };
      case 'revokeGroupInvite':
        return { ok: true, result: await wa.revokeWhatsAppGroupInvite(userId, pickWhatsAppRecipient(params)) };
      case 'setGroupSetting':
        return { ok: true, result: await wa.setWhatsAppGroupSetting(userId, pickWhatsAppRecipient(params), params.setting, params.value) };

      // ─── FULL CRUD: Account ────────────────────────────────────────
      case 'changeAvatar':
        return { ok: true, result: await wa.updateWhatsAppAvatar(userId, params.mediaUrl || params.url) };
      case 'changePushName':
        return { ok: true, result: await wa.updateWhatsAppPushName(userId, params.name) };
      case 'sendPresence':
        return { ok: true, result: await wa.setWhatsAppPresence(userId, params.text === 'available' ? 'available' : 'unavailable') };
      case 'getStatus':
        return { ok: true, status: await wa.getWhatsAppStatus(userId, pickWhatsAppRecipient(params)) };

      case 'syncFullHistory':
      case 'sync_full_history':
      case 'resync':
        return { ok: true, result: await wa.forceResync(userId) };

      // ─── FILE / ATTACHMENT OPERATIONS ────────────────────────────────
      case 'readAttachment':
        return handleReadAttachment(wa, userId, effectivePermissions, pickWhatsAppRecipient(params), params.messageId);

      case 'sendDocument':
        return handleSendDocument(wa, userId, effectivePermissions, pickWhatsAppRecipient(params), params.content, params.fileName, params.caption);

      default:
        return { ok: false, error: `Unknown WhatsApp tool: ${tool}` };
    }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Operation failed' };
  }
}

async function handleSendMediaOrMessage(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  tool: string,
  params: any,
  isGroupMessage = false,
) {
  let mediaType: any = null;
  if (tool === 'sendImage') mediaType = 'image';
  else if (tool === 'sendFile') mediaType = 'document';
  else if (tool === 'sendVideo') mediaType = 'video';
  else if (tool === 'sendSticker') mediaType = 'sticker';
  else if (tool === 'sendAudio') mediaType = 'audio';
  else if (tool === 'sendMedia') mediaType = params.mediaType || params.type || 'image';

  return handleSendMessage(
    wa,
    userId,
    permissions,
    pickWhatsAppRecipient(params),
    pickWhatsAppText(params),
    params.mediaUrl || params.url,
    mediaType,
    params.caption || params.text || params.message,
    params.ptt,
    isGroupMessage ? 'send_group_messages' : 'send_messages',
  );
}

export async function handleSendMessage(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  to: string,
  text: string,
  mediaUrl?: string,
  mediaType?: 'image' | 'video' | 'document' | 'sticker' | 'audio',
  caption?: string,
  ptt?: boolean,
  requiredPermission: Permission = 'send_messages',
): Promise<{ ok: true; sent: boolean; chatId: string; messageId?: string } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, requiredPermission);
  if (denied) return { ok: false, error: denied };
  const approvalDenied = requireDelegatedSendApproval(permissions);
  if (approvalDenied) return { ok: false, error: approvalDenied };

  const recipientError = requireText(to, 'Recipient');
  if (recipientError) return { ok: false, error: recipientError };

  if (!mediaUrl) {
    const textError = requireText(text, 'Message text');
    if (textError) return { ok: false, error: textError };
  }

  try {
    const sock = wa.getClient(userId);
    const chatId = wa.resolveContactJid(userId, to);

    if (mediaUrl && mediaType) {
      const sent = await wa.sendWhatsAppMediaMessage(userId, to, mediaUrl, mediaType, caption || text, ptt);
      if (sent) return { ok: true, sent: true, chatId: sent.chatId, messageId: sent.messageId };
      return { ok: false, error: 'Failed to send media message' };
    }

    if (!sock) {
      const cloudSent = await wa.sendCloudTextMessage(userId, to, text);
      if (cloudSent) {
        wa.trackSentMessage(userId, cloudSent.chatId, text, false, cloudSent.messageId);
        return { ok: true, sent: true, chatId: cloudSent.chatId, messageId: cloudSent.messageId };
      }
      return { ok: false, error: 'WhatsApp not paired and no WhatsApp Cloud API credentials are configured' };
    }
    const sent = await sock.sendMessage(chatId, { text });
    const msgId = sent?.key?.id;
    wa.trackSentMessage(userId, chatId, text, chatId.endsWith('@g.us'), msgId);
    return { ok: true, sent: true, chatId, messageId: msgId };
  } catch (error: any) {
    return { ok: false, error: error.message || 'Send failed' };
  }
}

export async function handleReadChats(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  limit: number = 20,
): Promise<{ ok: true; chats: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'read_chats');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  return { ok: true, chats: await wa.getChats(userId, cleanLimit(limit)) };
}

export async function handleGetContacts(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
): Promise<{ ok: true; contacts: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'access_contacts');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const raw = wa.getContacts(userId);
  const contacts = raw.map(c => ({
    id: c.id,
    number: c.number,
    savedName: c.name,
    whatsappProfileName: c.notify,
    verifiedName: c.verifiedName,
  }));
  return { ok: true, contacts };
}

export async function handleGetGroups(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
): Promise<{ ok: true; groups: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'access_groups');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  try {
    const groups = await wa.getGroups(userId);
    return { ok: true, groups };
  } catch (error: any) {
    return { ok: false, error: error.message || 'Failed to get groups' };
  }
}

export async function handleGetMessageHistory(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  chatId: string,
  limit: number = 20,
): Promise<{ ok: true; messages: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'view_message_history');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const chatError = requireText(chatId, 'Chat ID');
  if (chatError) return { ok: false, error: chatError };
  const resolvedJid = wa.resolveContactJid(userId, chatId);
  return { ok: true, messages: await wa.getMessageHistory(userId, resolvedJid, cleanLimit(limit, HISTORY_RESPONSE_LIMIT, HISTORY_RESPONSE_LIMIT)) };
}

export async function handleGetCalls(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  limit: number = 20,
): Promise<{ ok: true; calls: any[] } | { ok: false; error: string }> {
  const denied = requirePerm(permissions, 'view_message_history');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  return { ok: true, calls: wa.getCalls(userId, cleanLimit(limit)) };
}

export async function handleSendButtons(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  to: string,
  text: string,
  buttons: Array<{ id?: string; text?: string }> = [],
  footer?: string,
): Promise<{ ok: true; sent: boolean; chatId: string; messageId?: string } | { ok: false; error: string }> {
  const renderedButtons = buttons
    .map((button, index) => `${index + 1}. ${button.text || button.id || `Option ${index + 1}`}`)
    .join('\n');
  const body = [text, renderedButtons, footer].filter(Boolean).join('\n\n');
  return handleSendMessage(wa, userId, permissions, to, body);
}

export async function handleReadAttachment(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  chatId: string,
  messageId: string,
): Promise<any> {
  const denied = requirePerm(permissions, 'access_documents');
  if (denied) return { ok: false, error: denied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const result = await wa.downloadAttachmentContent(userId, chatId, messageId);
  if (!result) return { ok: false, error: 'Attachment not found or expired' };
  const { extractFileContent } = await import('./file-extractor');
  const extracted = extractFileContent(result.buffer, result.mimeType, result.fileName);
  return { ok: true, ...extracted };
}

export async function handleSendDocument(
  wa: WhatsAppManager,
  userId: string,
  permissions: Record<string, any> | undefined,
  to: string,
  content: string,
  fileName: string,
  caption?: string,
): Promise<any> {
  const denied = requirePerm(permissions, 'send_messages');
  if (denied) return { ok: false, error: denied };
  const approvalDenied = requireDelegatedSendApproval(permissions);
  if (approvalDenied) return { ok: false, error: approvalDenied };
  if (!wa.isPaired(userId)) return { ok: false, error: 'WhatsApp not paired' };
  const buffer = Buffer.from(content, 'utf-8');
  const sent = await wa.sendDocumentBuffer(userId, to, buffer, fileName, caption);
  if (!sent) return { ok: false, error: 'Failed to send document' };
  return { ok: true, sent: true, chatId: sent.chatId, messageId: sent.messageId };
}
