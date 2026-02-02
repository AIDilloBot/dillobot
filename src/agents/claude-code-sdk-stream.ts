/**
 * Claude Code SDK Stream Function
 *
 * Provides a streamFn implementation that uses the Claude Agent SDK,
 * making it work at the same level as other LLM providers in pi-ai.
 *
 * This integrates the SDK at the streaming level, NOT as a separate
 * agent flow. OpenClaw handles tools, session management, and context
 * building - the SDK just does the completion.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  TextContent,
  Tool,
  ToolCall,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai/dist/utils/event-stream.js";
import { isClaudeCodeSdkProvider } from "./claude-code-sdk-runner.js";

/**
 * SDK tools configuration type.
 * The SDK only accepts preset tools or tool name strings, not custom definitions.
 */
type SdkToolsConfig = { type: "preset"; preset: "claude_code" } | string[];

/**
 * Determine SDK tools configuration based on context.
 *
 * DILLOBOT: Use preset tools so the SDK can execute Claude Code tools internally.
 * With maxTurns: 100, the SDK handles the full agentic loop until Claude finishes.
 */
function getSdkToolsConfig(tools: Tool[] | undefined): SdkToolsConfig {
  // Use preset tools so the SDK can execute Claude Code tools internally.
  if (tools && tools.length > 0) {
    return { type: "preset", preset: "claude_code" };
  }
  return [];
}

// Dynamic import for the Claude Agent SDK
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;

async function loadSdk() {
  if (!sdkModule) {
    try {
      sdkModule = await import("@anthropic-ai/claude-agent-sdk");
    } catch (error) {
      throw new Error(
        "Claude Agent SDK not available. Please install @anthropic-ai/claude-agent-sdk",
      );
    }
  }
  return sdkModule;
}

/**
 * Light stripping for real-time streaming.
 * Only removes patterns we're confident are tool syntax, not aggressive.
 * Used during streaming to provide responsive feedback while avoiding obvious tool leaks.
 */
function stripToolSyntaxLight(text: string): string {
  let result = text;
  // Remove obvious tool: patterns at end of text (might be incomplete)
  result = result.replace(/\s*tool:[a-z_-]*$/gi, "");
  // Remove trailing colons that might precede tool syntax
  result = result.replace(/:\s*$/g, " ");
  return result;
}

/**
 * Strip Claude Code's tool invocation output from text.
 *
 * The SDK outputs tool calls in multiple formats:
 * 1. XML: <tool_use>...</tool_use> blocks
 * 2. Text: "tool:toolname\narguments" format
 * 3. Verbose: "checking...", "reading...", etc. status lines
 *
 * For chatbot use, we want clean output without these internal mechanics.
 */
function stripToolUseXml(text: string): string {
  let result = text;

  // Strip <tool_use>...</tool_use> XML blocks (including nested content)
  result = result.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "");

  // Strip tool:exec with XML-style command blocks (with content)
  result = result.replace(
    /tool:exec\s*\n\s*<command>[\s\S]*?<\/command>\s*\n?\s*<\/tool:exec>/gi,
    "",
  );

  // Strip empty tool:exec blocks (no content between tags)
  // Format: tool:exec\n\n</tool:exec> or tool:exec\n</tool:exec>
  result = result.replace(/tool:[a-z_-]+\s*[\n\r]+\s*<\/tool:[a-z_-]+>/gi, "");

  // Strip any tool:name ... </tool:name> hybrid blocks with content
  result = result.replace(/tool:[a-z_-]+\s*\n[\s\S]*?<\/tool:[a-z_-]+>/gi, "");

  // Strip </tool:*> closing tags that might be orphaned
  result = result.replace(/<\/tool:[a-z_-]+>/gi, "");

  // Strip standalone tool XML tags
  result = result.replace(/<\/?tool_(?:use|name|result)>/g, "");

  // Strip <command>...</command> blocks that might be orphaned
  result = result.replace(/<command>[\s\S]*?<\/command>/gi, "");

  // DILLOBOT: Strip text-format tool invocations
  // Format: "tool:toolname" followed by arguments/output on subsequent lines
  // Examples:
  //   tool:read
  //   IDENTITY.md
  //
  //   tool:exec
  //   ls -la
  //   [output lines]
  //
  //   tool:bash
  //   echo hello

  // Match tool:name followed by any content until next tool: or end of significant content
  // This handles multi-line tool output
  result = result.replace(/^tool:[a-z_-]+\s*\n(?:(?!tool:)[^\n]*\n?)*/gim, "");

  // Also strip standalone tool: lines that might be orphaned
  result = result.replace(/^tool:[a-z_-]+\s*$/gim, "");

  // Strip inline tool: invocations (not at start of line)
  // Catches cases like "Let me check: tool:exec" where tool:name appears inline
  // The \s+ before requires whitespace so we don't match "protocol:tcp" etc.
  result = result.replace(/\s+tool:[a-z_-]+\s*$/gim, "");

  // Strip tool: followed by newlines (mid-text, not at line end)
  // Catches "Let me check: tool:exec\nI'll look at..." where tool is followed by newline
  result = result.replace(/\s+tool:[a-z_-]+\s*\n/gim, "\n");

  // Strip tool: at end of text (no trailing newline)
  // Catches "...checking:\n\ntool:exec" where tool:exec is the last thing
  result = result.replace(/\btool:[a-z_-]+\s*$/gi, "");

  // FINAL CATCH-ALL: Strip any remaining tool: patterns that look like SDK tool calls
  // This catches edge cases where tool:name appears in unexpected positions
  // Only strip if it looks like a tool invocation (word boundary before, not part of URL/path)
  // Match: whitespace/newline/colon + "tool:" + toolname + optional whitespace/newline/end
  result = result.replace(/(?:^|[\s:])tool:[a-z_-]+(?:\s|$)/gim, " ");

  // Strip "checking/reading/looking" status lines that precede tool calls
  // These are verbose status messages the SDK outputs
  result = result.replace(
    /^(?:checking|reading|looking|searching|writing|creating|updating|deleting|running|executing|fetching|loading|saving|calling)[^\n]*\.{3,}\s*\n?/gim,
    "",
  );

  // Strip lines that are just filenames/paths (leftovers from tool args)
  // Only if they look like file paths and are on their own line
  result = result.replace(
    /^(?:\.\/|\/)?[\w\-./]+\.(?:md|txt|ts|js|json|yaml|yml|sh|py|rb|go|rs)\s*$/gim,
    "",
  );

  // Clean up excessive whitespace left behind
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  return result;
}

/**
 * Format pi-ai messages into a prompt string for the SDK.
 *
 * Since the SDK expects a single prompt, we need to format the
 * message history in a way Claude understands as conversation context.
 */
function formatMessagesForSdk(messages: Message[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((c): c is TextContent => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      parts.push(`Human: ${content}`);
    } else if (msg.role === "assistant") {
      const textContent = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (textContent) {
        parts.push(`Assistant: ${textContent}`);
      }

      // Include tool calls as context
      const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
      for (const tc of toolCalls) {
        parts.push(`Assistant used tool: ${tc.name}`);
      }
    } else if (msg.role === "toolResult") {
      const resultText = msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      parts.push(`Tool result (${msg.toolName}): ${resultText}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Get the latest user message from the context.
 */
function getLatestUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      return msg.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
  }
  return "";
}

/**
 * Process SDK messages and push events to the stream.
 *
 * DILLOBOT: Now accepts tools configuration to pass to the Claude API so it
 * outputs proper tool_use blocks that pi-agent-core can execute.
 */
async function processSdkQuery(
  sdk: typeof import("@anthropic-ai/claude-agent-sdk"),
  prompt: string,
  systemPrompt: string | undefined,
  toolsConfig: SdkToolsConfig,
  model: Model<any>,
  options: SimpleStreamOptions | undefined,
  stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
  const abortController = new AbortController();

  // Link to provided abort signal
  if (options?.signal) {
    options.signal.addEventListener("abort", () => {
      abortController.abort();
    });
  }

  // Build partial message that we'll update as we stream
  const partialMessage: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  // Emit start event
  stream.push({ type: "start", partial: partialMessage });

  let currentTextIndex = -1;
  let currentText = "";
  let lastEmittedLength = 0; // Track what we've already streamed to the user
  let textStartEmitted = false; // Track if we've emitted text_start for current block
  let isInToolExecution = false; // Track if we're waiting for tool results

  try {
    // Configure the SDK for full agentic loop
    // - Pass tools config so Claude can use Claude Code tools
    // - maxTurns: 100 (SDK handles full loop until Claude finishes)
    // - persistSession: false (OpenClaw manages sessions)
    //
    // The SDK handles the complete agentic loop including tool execution.
    // With preset tools, Claude outputs tool_use blocks which the SDK executes
    // internally using Claude Code's tool implementations.
    const queryIterator = sdk.query({
      prompt,
      options: {
        abortController,
        model: model.id,
        // DILLOBOT: Use preset tools so SDK can execute Claude Code tools internally
        tools: toolsConfig,
        // Let Claude work until done - no artificial turn limit
        maxTurns: 100,
        // Don't persist to SDK session files - OpenClaw manages sessions
        persistSession: false,
        // Pass the system prompt
        systemPrompt: systemPrompt || undefined,
        // Include partial messages for streaming
        includePartialMessages: true,
        // Bypass permissions since we're non-interactive
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of queryIterator) {
      // Check for abort
      if (abortController.signal.aborted) {
        partialMessage.stopReason = "aborted";
        stream.push({ type: "error", reason: "aborted", error: partialMessage });
        stream.end(partialMessage);
        return;
      }

      // Handle user message (tool result) - indicates tool execution in progress
      if (message.type === "user") {
        isInToolExecution = true;
        continue;
      }

      if (message.type === "assistant") {
        // Full assistant message - extract content
        // This comes after streaming events, use it to sync state
        const betaMessage = message.message;
        if (betaMessage?.content) {
          for (const block of betaMessage.content) {
            if ("text" in block && typeof block.text === "string") {
              // Update our buffer with the full text
              if (currentTextIndex < 0) {
                currentTextIndex = partialMessage.content.length;
                partialMessage.content.push({ type: "text", text: "" });
              }
              if (!textStartEmitted) {
                stream.push({
                  type: "text_start",
                  contentIndex: currentTextIndex,
                  partial: partialMessage,
                });
                textStartEmitted = true;
              }

              // Sync text buffer with full message
              const newText = block.text;
              if (newText.length > currentText.length) {
                // Emit any text we haven't streamed yet
                const cleanedNew = stripToolSyntaxLight(newText);
                if (cleanedNew.length > lastEmittedLength) {
                  const newContent = cleanedNew.slice(lastEmittedLength);
                  if (newContent.trim()) {
                    stream.push({
                      type: "text_delta",
                      contentIndex: currentTextIndex,
                      delta: newContent,
                      partial: partialMessage,
                    });
                    lastEmittedLength = cleanedNew.length;
                  }
                }
                currentText = newText;
                (partialMessage.content[currentTextIndex] as TextContent).text = currentText;
              }
            } else if ("type" in block && block.type === "tool_use") {
              // SDK returned a tool call - map it to ToolCall format
              const toolBlock = block as {
                id: string;
                name: string;
                input: Record<string, unknown>;
              };
              const toolCallIndex = partialMessage.content.length;
              const toolCall: ToolCall = {
                type: "toolCall",
                id: toolBlock.id,
                name: toolBlock.name,
                arguments: toolBlock.input,
              };
              partialMessage.content.push(toolCall);
              stream.push({
                type: "toolcall_start",
                contentIndex: toolCallIndex,
                partial: partialMessage,
              });
              stream.push({
                type: "toolcall_end",
                contentIndex: toolCallIndex,
                toolCall,
                partial: partialMessage,
              });
            }
          }
        }

        // Update usage if available
        if (betaMessage?.usage) {
          partialMessage.usage = {
            input: betaMessage.usage.input_tokens ?? 0,
            output: betaMessage.usage.output_tokens ?? 0,
            cacheRead:
              (betaMessage.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ??
              0,
            cacheWrite:
              (betaMessage.usage as { cache_creation_input_tokens?: number })
                .cache_creation_input_tokens ?? 0,
            totalTokens:
              (betaMessage.usage.input_tokens ?? 0) + (betaMessage.usage.output_tokens ?? 0),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
        }
      } else if (message.type === "stream_event") {
        // Streaming delta events from SDK
        const streamEvent = message as {
          event?: {
            type?: string;
            index?: number;
            delta?: { type?: string; text?: string };
            content_block?: { type?: string; text?: string };
          };
        };

        // Stream text in real-time for responsive UX
        // Handle content_block_start
        if (streamEvent.event?.type === "content_block_start") {
          if (streamEvent.event.content_block?.type === "text") {
            // New text block starting
            if (currentTextIndex < 0) {
              currentTextIndex = partialMessage.content.length;
              partialMessage.content.push({ type: "text", text: "" });
            }
            // Emit text_start immediately for responsive streaming
            if (!textStartEmitted) {
              stream.push({
                type: "text_start",
                contentIndex: currentTextIndex,
                partial: partialMessage,
              });
              textStartEmitted = true;
            }
            isInToolExecution = false; // We're back to receiving text
          } else if (streamEvent.event.content_block?.type === "tool_use") {
            // Tool execution starting - flush current text to channel before tools run
            isInToolExecution = true;

            // Emit text_end to flush current content to the messaging channel
            // This ensures user sees "Let me check..." BEFORE tool execution
            if (currentTextIndex >= 0 && textStartEmitted && currentText.trim()) {
              const cleanedForFlush = stripToolSyntaxLight(currentText).trim();
              if (cleanedForFlush) {
                // Update partial message with current clean text
                (partialMessage.content[currentTextIndex] as TextContent).text = cleanedForFlush;

                // Emit text_end to trigger onBlockReply and send to channel
                stream.push({
                  type: "text_end",
                  contentIndex: currentTextIndex,
                  content: cleanedForFlush,
                  partial: partialMessage,
                });

                // Reset for next text block (after tool execution)
                currentTextIndex = -1;
                currentText = "";
                lastEmittedLength = 0;
                textStartEmitted = false;
              }
            }
          }
        }

        // Handle content_block_delta - stream text in real-time
        if (streamEvent.event?.type === "content_block_delta") {
          if (streamEvent.event.delta?.type === "text_delta" && streamEvent.event.delta.text) {
            if (currentTextIndex < 0) {
              currentTextIndex = partialMessage.content.length;
              partialMessage.content.push({ type: "text", text: "" });
            }
            if (!textStartEmitted) {
              stream.push({
                type: "text_start",
                contentIndex: currentTextIndex,
                partial: partialMessage,
              });
              textStartEmitted = true;
            }

            // Add delta to buffer
            const delta = streamEvent.event.delta.text;
            currentText += delta;
            (partialMessage.content[currentTextIndex] as TextContent).text = currentText;

            // Emit cleaned delta for real-time streaming
            // Use light stripping to avoid obvious tool syntax
            const cleanedCurrent = stripToolSyntaxLight(currentText);
            if (cleanedCurrent.length > lastEmittedLength) {
              const newContent = cleanedCurrent.slice(lastEmittedLength);
              if (newContent.trim()) {
                stream.push({
                  type: "text_delta",
                  contentIndex: currentTextIndex,
                  delta: newContent,
                  partial: partialMessage,
                });
                lastEmittedLength = cleanedCurrent.length;
              }
            }
          }
        }
      } else if (message.type === "result") {
        // Final result
        if (message.subtype === "success") {
          const successMsg = message as {
            result?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };

          // Update final text if provided
          if (successMsg.result && successMsg.result !== currentText) {
            if (currentTextIndex < 0) {
              currentTextIndex = partialMessage.content.length;
              partialMessage.content.push({ type: "text", text: "" });
            }
            // Just update the buffer - clean content will be emitted at text_end
            currentText = successMsg.result;
            (partialMessage.content[currentTextIndex] as TextContent).text = currentText;
          }

          // Update usage
          if (successMsg.usage) {
            partialMessage.usage = {
              input: successMsg.usage.input_tokens ?? 0,
              output: successMsg.usage.output_tokens ?? 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens:
                (successMsg.usage.input_tokens ?? 0) + (successMsg.usage.output_tokens ?? 0),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            };
          }

          // IMPORTANT: Claude Code SDK handles tools internally with maxTurns.
          // By the time we receive the final result, all tools have been executed.
          // We must NOT signal "toolUse" or pi-agent-core will try to execute them again.
          // Filter out tool call content blocks to prevent downstream code from re-executing.
          partialMessage.content = partialMessage.content.filter((c) => c.type !== "toolCall");
          partialMessage.stopReason = "stop";
        } else {
          // Error result
          const errorMsg = message as { errors?: string[] };
          partialMessage.stopReason = "error";
          partialMessage.errorMessage = errorMsg.errors?.join("; ") ?? "Unknown error";
        }
      }
    }

    // Final cleanup - emit any remaining text after full stripping
    if (currentTextIndex >= 0) {
      // Apply full stripping to remove any tool syntax that slipped through
      const cleanText = stripToolUseXml(currentText);

      // Remove the "_Working..._" status messages we added during tool execution
      const finalText = cleanText
        .replace(/\n\n_Working\.\.\._\n\n/g, "\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      // Update the partial message with final clean text
      (partialMessage.content[currentTextIndex] as TextContent).text = finalText;

      // Emit text_start if we haven't already (rare case - no streaming happened)
      if (!textStartEmitted) {
        stream.push({
          type: "text_start",
          contentIndex: currentTextIndex,
          partial: partialMessage,
        });
      }

      // Emit text_end with the final content
      // Note: We've already streamed most content, but text_end signals completion
      stream.push({
        type: "text_end",
        contentIndex: currentTextIndex,
        content: finalText,
        partial: partialMessage,
      });
    }

    // Emit done event
    if (partialMessage.stopReason === "error") {
      stream.push({ type: "error", reason: "error", error: partialMessage });
    } else {
      stream.push({
        type: "done",
        reason: partialMessage.stopReason as "stop" | "length" | "toolUse",
        message: partialMessage,
      });
    }

    stream.end(partialMessage);
  } catch (error) {
    partialMessage.stopReason = "error";
    partialMessage.errorMessage = error instanceof Error ? error.message : String(error);
    stream.push({ type: "error", reason: "error", error: partialMessage });
    stream.end(partialMessage);
  }
}

/**
 * Create a streamFn that uses Claude Agent SDK.
 *
 * This makes the SDK work at the same level as streamSimple from pi-ai,
 * allowing it to integrate with OpenClaw's existing infrastructure.
 */
export function createClaudeCodeSdkStreamFn() {
  return function claudeCodeSdkStream(
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
  ): ReturnType<typeof createAssistantMessageEventStream> {
    const stream = createAssistantMessageEventStream();

    // Build the prompt from message history
    // The SDK expects a single prompt, so we format the history
    const formattedHistory = formatMessagesForSdk(context.messages.slice(0, -1));
    const latestMessage = getLatestUserMessage(context.messages);

    // Combine history context with latest message
    let prompt: string;
    if (formattedHistory) {
      prompt = `Previous conversation:\n${formattedHistory}\n\nHuman: ${latestMessage}`;
    } else {
      prompt = latestMessage;
    }

    // Get SDK tools configuration for proper tool_use output
    const toolsConfig = getSdkToolsConfig(context.tools);

    // Start processing asynchronously
    loadSdk()
      .then((sdk) => {
        return processSdkQuery(
          sdk,
          prompt,
          context.systemPrompt,
          toolsConfig,
          model,
          options,
          stream,
        );
      })
      .catch((error) => {
        const errorMessage: AssistantMessage = {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        stream.push({ type: "error", reason: "error", error: errorMessage });
        stream.end(errorMessage);
      });

    return stream;
  };
}

/**
 * Check if we can use Claude Code SDK streaming.
 */
export async function isClaudeCodeSdkStreamAvailable(): Promise<boolean> {
  try {
    await loadSdk();
    return true;
  } catch {
    return false;
  }
}

// Re-export for convenience
export { isClaudeCodeSdkProvider } from "./claude-code-sdk-runner.js";

/**
 * Resolve the appropriate streamFn for the given provider.
 *
 * DILLOBOT: This function wraps streamFn resolution to support Claude SDK.
 * For claude-code-agent provider, returns the SDK streamFn.
 * For all other providers, returns the provided default streamFn unchanged.
 *
 * This is designed to minimize changes to upstream files - only a single
 * function call is needed in attempt.ts.
 */
export function resolveStreamFnForProvider(
  provider: string,
  defaultStreamFn: ReturnType<typeof createClaudeCodeSdkStreamFn>,
): ReturnType<typeof createClaudeCodeSdkStreamFn> {
  if (isClaudeCodeSdkProvider(provider)) {
    return createClaudeCodeSdkStreamFn();
  }
  return defaultStreamFn;
}
