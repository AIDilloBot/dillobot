/**
 * DilloBot Claude Code SDK Auth Handler
 *
 * Handles authentication using Claude Code subscription.
 * This is the PREFERRED auth method for DilloBot.
 */

import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { upsertAuthProfile } from "../agents/auth-profiles.js";
import {
  getClaudeCodeAuth,
  getClaudeCodeAuthInfo,
  isClaudeCodeSubscriptionAvailable,
} from "../agents/claude-code-sdk-auth.js";
import { applyAuthProfileConfig } from "./onboard-auth.js";

export async function applyAuthChoiceClaudeCodeSdk(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "claude-code-sdk") {
    return null;
  }

  let nextConfig = params.config;

  // Check if Claude Code subscription is available
  const isAvailable = await isClaudeCodeSubscriptionAvailable();

  if (!isAvailable) {
    await params.prompter.note(
      [
        "Claude Code CLI not detected.",
        "",
        "To use Claude Code SDK authentication:",
        "1. Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
        "2. Authenticate: claude login",
        "3. Run DilloBot onboarding again",
        "",
        "Or choose a different authentication method.",
      ].join("\n"),
      "Claude Code SDK",
    );

    // Return null to let other handlers try
    return null;
  }

  // Get auth info for display
  const authInfo = await getClaudeCodeAuthInfo();
  const auth = await getClaudeCodeAuth();

  if (!auth) {
    await params.prompter.note(
      "Claude Code authentication failed. Please try again or choose a different method.",
      "Error",
    );
    return null;
  }

  // Show confirmation
  const versionInfo = authInfo.version ? ` (${authInfo.version})` : "";

  const confirmed = await params.prompter.confirm({
    message: `Use Claude Code CLI${versionInfo} for authentication?`,
    initialValue: true,
  });

  if (!confirmed) {
    return null;
  }

  // Store the auth profile
  const profileId = "claude-code-sdk:subscription";
  const provider = "claude-code-agent";

  upsertAuthProfile({
    profileId,
    agentDir: params.agentDir,
    credential: {
      type: "subscription",
      provider,
      token: "claude-agent-sdk", // Marker token - actual auth handled by SDK
    },
  });

  // Apply auth profile config
  nextConfig = applyAuthProfileConfig(nextConfig, {
    profileId,
    provider,
    mode: "subscription",
  });

  // DILLOBOT: Also set the model config in agents.defaults
  const modelRef = `${provider}/claude-sonnet-4-5`;
  const existingModel = nextConfig.agents?.defaults?.model;
  nextConfig = {
    ...nextConfig,
    agents: {
      ...nextConfig.agents,
      defaults: {
        ...nextConfig.agents?.defaults,
        model: {
          ...(existingModel && typeof existingModel === "object" && "fallbacks" in existingModel
            ? { fallbacks: (existingModel as { fallbacks?: string[] }).fallbacks }
            : undefined),
          primary: modelRef,
        },
      },
    },
  };

  await params.prompter.note(
    [
      "Claude Code SDK configured successfully!",
      "",
      "Benefits:",
      "- No API keys to manage",
      "- Uses your Claude Code subscription",
      "- Automatic authentication via Claude CLI",
      "",
      "DilloBot will use the Claude Agent SDK for all requests.",
    ].join("\n"),
    "Success",
  );

  return { config: nextConfig };
}
