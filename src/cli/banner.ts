// DILLOBOT-BRANDING-START
import { DILLOBOT_PRODUCT_NAME, DILLOBOT_EMOJI, UPSTREAM_VERSION } from "../dillobot-version.js";
import { resolveCommitHash } from "../infra/git-commit.js";
import { visibleWidth } from "../terminal/ansi.js";
import { isRich, theme } from "../terminal/theme.js";
import { pickTagline, type TaglineOptions } from "./tagline.js";
// DILLOBOT-BRANDING-END

type BannerOptions = TaglineOptions & {
  argv?: string[];
  commit?: string | null;
  columns?: number;
  richTty?: boolean;
};

let bannerEmitted = false;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  } catch {
    return Array.from(value);
  }
}

const hasJsonFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--json" || arg.startsWith("--json="));

const hasVersionFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--version" || arg === "-V" || arg === "-v");

export function formatCliBannerLine(version: string, options: BannerOptions = {}): string {
  const commit = options.commit ?? resolveCommitHash({ env: options.env });
  const commitLabel = commit ?? "unknown";
  const tagline = pickTagline(options);
  const rich = options.richTty ?? isRich();
  // DILLOBOT-BRANDING-START
  const title = `${DILLOBOT_EMOJI} ${DILLOBOT_PRODUCT_NAME}`;
  const prefix = `${DILLOBOT_EMOJI} `;
  const upstreamLabel = `OpenClaw ${UPSTREAM_VERSION}`;
  // DILLOBOT-BRANDING-END
  const columns = options.columns ?? process.stdout.columns ?? 120;
  // DILLOBOT-BRANDING-START - Show upstream version
  const plainFullLine = `${title} ${version} (${commitLabel}) [${upstreamLabel}] — ${tagline}`;
  // DILLOBOT-BRANDING-END
  const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
  if (rich) {
    if (fitsOnOneLine) {
      // DILLOBOT-BRANDING-START
      return `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
        `(${commitLabel})`,
      )} ${theme.muted(`[${upstreamLabel}]`)} ${theme.muted("—")} ${theme.accentDim(tagline)}`;
      // DILLOBOT-BRANDING-END
    }
    // DILLOBOT-BRANDING-START
    const line1 = `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
      `(${commitLabel})`,
    )} ${theme.muted(`[${upstreamLabel}]`)}`;
    // DILLOBOT-BRANDING-END
    const line2 = `${" ".repeat(prefix.length)}${theme.accentDim(tagline)}`;
    return `${line1}\n${line2}`;
  }
  if (fitsOnOneLine) {
    return plainFullLine;
  }
  // DILLOBOT-BRANDING-START
  const line1 = `${title} ${version} (${commitLabel}) [${upstreamLabel}]`;
  // DILLOBOT-BRANDING-END
  const line2 = `${" ".repeat(prefix.length)}${tagline}`;
  return `${line1}\n${line2}`;
}

// DILLOBOT-BRANDING-START
const DILLOBOT_ASCII = [
  "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
  "██░▄▄▀░█░▄▄░█░████░████░▄▄░██░▄▄▄░░██░▄▄▀░██▄░▄█░████",
  "██░███░█░▄▄░█░████░████░██░██░▄▄▀░░██░▄▄░░███░██▄░▄██",
  "██░▀▀░░█░▀▀░█░▀▀░█░▀▀░█░▀▀░██░▀▀▀░░██░▀▀▀░██▀░▀██▄███",
  "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
  "               🛡️  DILLOBOT 🛡️                     ",
  "          Armored AI. No compromises.              ",
  " ",
];
// DILLOBOT-BRANDING-END

export function formatCliBannerArt(options: BannerOptions = {}): string {
  const rich = options.richTty ?? isRich();
  // DILLOBOT-BRANDING-START
  if (!rich) {
    return DILLOBOT_ASCII.join("\n");
  }

  const colorChar = (ch: string) => {
    if (ch === "█") {
      return theme.accentBright(ch);
    }
    if (ch === "░") {
      return theme.accentDim(ch);
    }
    if (ch === "▀") {
      return theme.accent(ch);
    }
    return theme.muted(ch);
  };

  const colored = DILLOBOT_ASCII.map((line) => {
    if (line.includes("DILLOBOT")) {
      return (
        theme.muted("               ") +
        theme.accent("🛡️") +
        theme.info(` ${DILLOBOT_PRODUCT_NAME} `) +
        theme.accent("🛡️")
      );
    }
    if (line.includes("Armored AI")) {
      return theme.muted("          ") + theme.accentDim("Armored AI. No compromises.");
    }
    return splitGraphemes(line).map(colorChar).join("");
  });

  return colored.join("\n");
  // DILLOBOT-BRANDING-END
}

export function emitCliBanner(version: string, options: BannerOptions = {}) {
  if (bannerEmitted) {
    return;
  }
  const argv = options.argv ?? process.argv;
  if (!process.stdout.isTTY) {
    return;
  }
  if (hasJsonFlag(argv)) {
    return;
  }
  if (hasVersionFlag(argv)) {
    return;
  }
  const line = formatCliBannerLine(version, options);
  process.stdout.write(`\n${line}\n\n`);
  bannerEmitted = true;
}

export function hasEmittedCliBanner(): boolean {
  return bannerEmitted;
}
