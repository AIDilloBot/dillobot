import type { OpenClawConfig } from "../config/config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";
import { logWarn } from "../logger.js";
import {
  processContentSecurity,
  shouldBlockImmediately,
  type ContentSecurityConfig,
} from "../security-hardening/index.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatcher,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";

export type DispatchInboundResult = DispatchFromConfigResult;

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
  /** DILLOBOT: Security config overrides */
  securityConfig?: Partial<ContentSecurityConfig>;
}): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);

  // DILLOBOT: Process content through security pipeline
  const sessionKey = finalized.SessionKey ?? "unknown";
  const bodyToCheck = finalized.BodyForAgent ?? finalized.Body ?? "";

  // Quick check for critical patterns that should block immediately
  const quickBlock = shouldBlockImmediately(bodyToCheck);
  if (quickBlock.block) {
    logWarn(
      `[security] BLOCKED inbound message due to critical security pattern ` +
        `(session=${sessionKey}, from=${finalized.From}): ${quickBlock.reason}`,
    );
    // Return early without processing - message is blocked
    return {
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    };
  }

  // Run full security processing
  const securityResult = await processContentSecurity(
    bodyToCheck,
    {
      sessionKey,
      senderId: finalized.From,
      channel: finalized.ChatType,
      metadata: {
        accountId: finalized.AccountId,
        messageSid: finalized.MessageSid,
      },
    },
    undefined, // LLM provider not available at this point
    {
      enabled: true,
      llmAnalysisEnabled: false, // Disable LLM analysis (no provider here)
      blockOnCriticalPatterns: true,
      wrapExternalContent: true,
      stripUnicode: true,
      logEvents: true,
      ...params.securityConfig,
    },
  );

  // Check if blocked by security
  if (securityResult.blocked) {
    logWarn(
      `[security] BLOCKED inbound message: ${securityResult.blockReason} ` +
        `(session=${sessionKey}, from=${finalized.From})`,
    );
    // Return early without processing - message is blocked
    return {
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    };
  }

  // Log warnings
  if (securityResult.hasWarnings) {
    for (const warning of securityResult.warnings) {
      logWarn(`[security] ${warning} (session=${sessionKey})`);
    }
  }

  // Use processed content if it was modified (wrapped/sanitized)
  if (securityResult.processedContent !== bodyToCheck) {
    finalized.BodyForAgent = securityResult.processedContent;
  }

  return await dispatchReplyFromConfig({
    ctx: finalized,
    cfg: params.cfg,
    dispatcher: params.dispatcher,
    replyOptions: params.replyOptions,
    replyResolver: params.replyResolver,
  });
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcherWithTyping(
    params.dispatcherOptions,
  );

  const result = await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: {
      ...params.replyOptions,
      ...replyOptions,
    },
  });

  markDispatchIdle();
  return result;
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(params.dispatcherOptions);
  const result = await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
  await dispatcher.waitForIdle();
  return result;
}
