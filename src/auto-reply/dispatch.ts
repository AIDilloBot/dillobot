import type { OpenClawConfig } from "../config/config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { logWarn } from "../logger.js";
import { runSecurityGate } from "../security-hardening/injection/security-gate.js";
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
  /** LLM provider for security analysis (e.g., "claude-code-agent", "anthropic") */
  llmProvider?: string;
}): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);

  // DILLOBOT: Run security gate with LLM analysis
  // This checks content OUT-OF-BAND - the agent never sees blocked content
  const sessionKey = finalized.SessionKey ?? "unknown";
  const bodyToCheck = finalized.BodyForAgent ?? finalized.Body ?? "";

  // Resolve the LLM provider for security analysis
  const provider = params.llmProvider ?? DEFAULT_PROVIDER;

  // Run the security gate
  const securityResult = await runSecurityGate(bodyToCheck, {
    provider,
    sessionKey,
    senderId: finalized.From,
    channel: finalized.ChatType,
    apiKeys: {
      anthropic: params.cfg.models?.providers?.anthropic?.apiKey,
      openai: params.cfg.models?.providers?.openai?.apiKey,
    },
    enableLLMAnalysis: params.cfg.security?.llmAnalysis?.enabled !== false,
  });

  // If blocked, alert the user and don't process
  if (securityResult.blocked) {
    logWarn(
      `[security-gate] BLOCKED: ${securityResult.blockReason} ` +
        `(session=${sessionKey}, from=${finalized.From})`,
    );

    // Send alert to user via the dispatcher
    if (securityResult.alertMessage) {
      try {
        params.dispatcher.sendFinalReply({ text: securityResult.alertMessage });
      } catch (alertError) {
        logWarn(
          `[security-gate] Failed to send alert: ${alertError instanceof Error ? alertError.message : String(alertError)}`,
        );
      }
    }

    // Return early - the agent NEVER sees this content
    return {
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    };
  }

  // Content passed security gate - proceed with agent processing
  // NOTE: Agent receives CLEAN content, no security markers
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
