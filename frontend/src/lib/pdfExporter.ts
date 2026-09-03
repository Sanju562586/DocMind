import { Session, Message } from "@/lib/types";
import { format } from "date-fns";

/**
 * Unescapes any existing HTML entities in the source string to avoid double-encoding issues.
 */
function unescapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Escapes raw HTML special characters into valid HTML entities for safe embedding.
 */
function escapeHtml(str: string): string {
  if (!str) return "";
  return unescapeHtml(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * High-fidelity, space-efficient Markdown to HTML parser for DocMind PDF exports.
 * Renders headings, bold, italics, tables, syntax code blocks, bullet points,
 * blockquotes, and LaTeX math into compact, cleanly formatted HTML without entity corruption.
 */
function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return "";

  // 0. Clean and normalize source text
  let html = unescapeHtml(markdown.trim());

  // Fix unclosed bold right before a heading (e.g. `**Software### Clarification`)
  html = html.replace(/\*\*([^*\n#]+?)(?=#{1,6}\s|[^\n]*#{1,6}\s|#{1,6}[^\s#])/g, "**$1**\n\n");

  // Fix headings glued to preceding text/characters (e.g. `Word**### Heading` or `Word### Heading`)
  html = html.replace(/([^\n])\s*(#{1,6})(?=\s+[^\n]+|[^\s#\n][^\n]*)/g, "$1\n\n$2");

  // Fix headings missing space after # symbols (e.g. `###Clarification` -> `### Clarification`)
  html = html.replace(/^(#{1,6})([^#\s\n][^\n]*)$/gm, "$1 $2");

  // 1. Code blocks with language header and strict monospace alignment
  html = html.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    const cleanLang = lang.trim() || "CODE";
    const cleanCode = escapeHtml(code);
    return `
      <div class="code-block-wrapper" style="margin: 6px 0; background: #060608; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 5px; overflow: hidden; page-break-inside: avoid; break-inside: avoid;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.08); font-family: 'JetBrains Mono', monospace, Courier; font-size: 9px; color: #888888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
          <span>${escapeHtml(cleanLang)}</span>
        </div>
        <pre style="margin: 0; padding: 6px 10px; font-family: 'JetBrains Mono', 'Courier New', Courier, monospace; font-size: 10.5px; line-height: 1.4; color: #FFFFFF; overflow-x: auto; white-space: pre; letter-spacing: 0px; tab-size: 2;"><code>${cleanCode}</code></pre>
      </div>
    `;
  });

  // 2. Math display blocks ($$ ... $$ or \[ ... \])
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    return `
      <div class="katex-display-box" style="margin: 6px 0; padding: 6px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #FFFFFF; text-align: center; page-break-inside: avoid; break-inside: avoid;">
        ${escapeHtml(math.trim())}
      </div>
    `;
  });
  html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    return `
      <div class="katex-display-box" style="margin: 6px 0; padding: 6px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #FFFFFF; text-align: center; page-break-inside: avoid; break-inside: avoid;">
        ${escapeHtml(math.trim())}
      </div>
    `;
  });

  // 3. Tables (| a | b | ... |)
  html = html.replace(/((\|[^\n]+\|\r?\n)+)/g, (tableBlock) => {
    const lines = tableBlock.trim().split(/\r?\n/);
    if (lines.length < 2) return tableBlock;

    const headerLine = lines[0];
    const isDivider = lines[1].includes("---") || lines[1].includes("-|-");
    const dataLines = isDivider ? lines.slice(2) : lines.slice(1);

    const headers = headerLine
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, a) => (i > 0 && i < a.length - 1) || (a.length === 2 && c));

    const rows = dataLines.map((line) =>
      line
        .split("|")
        .map((c) => c.trim())
        .filter((c, i, a) => (i > 0 && i < a.length - 1) || (a.length === 2 && c))
    );

    const ths = headers
      .map(
        (h) =>
          `<th style="padding: 5px 8px; background: rgba(255, 255, 255, 0.08); color: #FFFFFF; font-weight: 700; border: 1px solid rgba(255, 255, 255, 0.12); text-align: left;">${escapeHtml(h)}</th>`
      )
      .join("");

    const trs = rows
      .map((row) => {
        const tds = row
          .map(
            (cell) =>
              `<td style="padding: 4px 8px; border: 1px solid rgba(255, 255, 255, 0.08); color: #D4D4D4;">${escapeHtml(cell)}</td>`
          )
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");

    return `
      <div style="margin: 6px 0; overflow-x: auto; page-break-inside: avoid; break-inside: avoid;">
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; background: #0A0A0C; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 4px; overflow: hidden;">
          <thead><tr>${ths}</tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    `;
  });

  // 4. Headings (compact margins)
  html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size: 11.5px; font-weight: 700; color: #FFFFFF; margin: 6px 0 2px; line-height: 1.35;">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 12.5px; font-weight: 700; color: #FFFFFF; margin: 7px 0 3px; line-height: 1.35;">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 13.5px; font-weight: 700; color: #FFFFFF; margin: 9px 0 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px; line-height: 1.35;">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 15px; font-weight: 800; color: #FFFFFF; margin: 10px 0 5px; line-height: 1.35;">$1</h1>');

  // 5. Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote style="border-left: 2.5px solid #FFFFFF; padding: 3px 8px; background: rgba(255,255,255,0.03); border-radius: 0 3px 3px 0; margin: 5px 0; color: #D4D4D4; font-style: italic;">$1</blockquote>');

  // 6. Horizontal Rules
  html = html.replace(/^---$/gim, '<hr style="border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 8px 0;" />');

  // 7. Bold & Italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong style="color: #FFFFFF;"><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #FFFFFF; font-weight: 700;">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em style="color: #D4D4D4;">$1</em>');

  // 8. Inline Code
  html = html.replace(/`([^`]+)`/g, (_, codeContent) => {
    return `<code style="font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 1px 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); border-radius: 3px; color: #FFFFFF;">${escapeHtml(codeContent)}</code>`;
  });

  // 9. Bullet Points & Lists
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li style="margin-bottom: 3px; color: #E5E5E5;">$1</li>');
  html = html.replace(/(<li style="margin-bottom: 3px; color: #E5E5E5;">.*<\/li>\s*)+/g, '<ul style="margin: 3px 0 6px 18px; padding-left: 2px;">$&</ul>');

  // 10. Numbered Lists
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li style="margin-bottom: 3px; color: #E5E5E5;">$1</li>');

  // 11. Paragraphs (compact 4px bottom margin)
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<div") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<blockquote") ||
        trimmed.startsWith("<hr")
      ) {
        return trimmed;
      }
      return `<p style="margin-bottom: 4px; line-height: 1.48; color: #E5E5E5;">${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");

  return html;
}

/**
 * Builds a clean, sequential, space-efficient HTML document matching the DocMind chat UI.
 */
function buildCompletePrintHtml(session: Session, messages: Message[]): string {
  const exportDateStr = format(new Date(), "MMM d, yyyy • h:mm a");

  // Build message items
  const messageCardsHtml = messages
    .map((msg) => {
      const isUser = msg.role === "user";
      const timeStr = (() => {
        try {
          return format(new Date(msg.created_at), "h:mm a");
        } catch {
          return "";
        }
      })();

      const contentHtml = isUser
        ? `<div style="white-space: pre-wrap; font-size: 11.5px; line-height: 1.45; color: #FFFFFF;">${escapeHtml(msg.content)}</div>`
        : `<div style="font-size: 11.5px; line-height: 1.5; color: #FFFFFF;">${renderMarkdownToHtml(msg.content)}</div>`;

      // Sources
      let sourcesHtml = "";
      if (!isUser && msg.sources && msg.sources.length > 0) {
        const sourceChips = msg.sources
          .slice(0, 4)
          .map((s) => {
            const title = escapeHtml(s.title || "Document");
            const section = escapeHtml(s.section || "");
            return `
              <div style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; font-size: 9px; color: #D4D4D4;">
                <span style="font-weight: 600;">${title}</span>
                ${section ? `<span style="opacity: 0.6;">• ${section}</span>` : ""}
              </div>
            `;
          })
          .join("");

        sourcesHtml = `
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06);">
            <span style="font-size: 9px; color: #888888; text-transform: uppercase; font-weight: 700; letter-spacing: 0.4px;">Sources:</span>
            ${sourceChips}
          </div>
        `;
      }

      if (isUser) {
        return `
          <div class="message-row user-row" style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 8px; width: 100%; page-break-inside: avoid; break-inside: avoid;">
            <div style="font-size: 9.5px; color: #888888; margin-bottom: 2px; font-weight: 600; padding-right: 2px;">
              You ${timeStr ? `<span style="opacity: 0.65;">• ${timeStr}</span>` : ""}
            </div>
            <div class="user-bubble" style="padding: 7px 11px; background: #141414; border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 8px; border-top-right-radius: 2px; color: #FFFFFF; max-width: 88%; word-break: break-word;">
              ${contentHtml}
            </div>
          </div>
        `;
      } else {
        return `
          <div class="message-row assistant-row" style="display: flex; flex-direction: column; align-items: flex-start; margin-bottom: 10px; width: 100%; page-break-inside: auto; break-inside: auto;">
            <div style="display: flex; align-items: center; gap: 5px; font-size: 9.5px; color: #FFFFFF; font-weight: 700; margin-bottom: 3px; padding-left: 2px;">
              <span style="width: 14px; height: 14px; border-radius: 3px; background: #FFFFFF; color: #000000; font-size: 9px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;">✦</span>
              <span>DocMind AI</span>
              ${timeStr ? `<span style="color: #888888; font-weight: 400; font-size: 9px;">• ${timeStr}</span>` : ""}
            </div>
            <div class="assistant-bubble" style="padding: 9px 13px; background: #080808; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; border-top-left-radius: 2px; color: #FFFFFF; width: 100%; word-break: break-word;">
              ${contentHtml}
              ${sourcesHtml}
            </div>
          </div>
        `;
      }
    })
    .join("");

  // Attached Documents list (compact single-row badge strip)
  const docsListHtml =
    session.documents && session.documents.length > 0
      ? `
      <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 6px;">
        <span style="font-size: 9.5px; color: #888888; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;">Docs:</span>
        ${session.documents
          .map(
            (d) => `
            <div style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; background: #111111; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; font-size: 9.5px; color: #FFFFFF; font-weight: 600;">
              <span style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(d.filename)}</span>
              <span style="font-size: 8.5px; color: #888888; font-weight: 400;">(${d.chunk_count} chunks)</span>
            </div>
          `
          )
          .join("")}
      </div>
    `
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>DocMind_Export_${escapeHtml(session.title.replace(/[^a-z0-9]/gi, "_").toLowerCase())}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 8mm 8mm 8mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      background-color: #000000 !important;
      color: #FFFFFF !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11.5px;
      line-height: 1.48;
      -webkit-font-smoothing: antialiased;
    }
    .page-wrapper {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 4px 6px;
      background-color: #000000;
    }
    .header-banner {
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      padding-bottom: 8px;
      margin-bottom: 10px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .message-row {
      page-break-inside: auto;
      break-inside: auto;
      orphans: 2;
      widows: 2;
    }
    .user-row {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .code-block-wrapper, table, blockquote, .katex-display-box {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .footer-bar {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      margin-top: 14px;
      padding-top: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 8.5px;
      color: #666666;
      page-break-inside: avoid;
      break-inside: avoid;
    }
  </style>
</head>
<body>
  <div class="page-wrapper">
    <!-- Header -->
    <div class="header-banner">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 20px; height: 20px; border-radius: 4px; background: #FFFFFF; color: #000000; font-weight: 800; font-size: 11px; display: flex; align-items: center; justify-content: center;">
            D
          </div>
          <span style="font-size: 12px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.01em;">DocMind AI</span>
          <span style="font-size: 9px; color: #888888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;">• Neural Intelligence</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; font-size: 9.5px; color: #888888;">
          <span>📅 ${exportDateStr}</span>
          <span>💬 ${messages.length} msg${messages.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <h1 style="font-size: 14.5px; font-weight: 700; color: #FFFFFF; margin: 4px 0 2px; letter-spacing: -0.01em; line-height: 1.3;">
        ${escapeHtml(session.title)}
      </h1>

      ${docsListHtml}
    </div>

    <!-- Sequential Messages Stream -->
    <div class="messages-flow">
      ${messageCardsHtml}
    </div>

    <!-- Footer -->
    <div class="footer-bar">
      <span>DocMind AI • Neural Document Intelligence Platform</span>
      <span>Confidential & AI-Generated</span>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Exports the active session and conversation directly to a pristine, space-efficient PDF.
 * Uses an isolated vector print document pipeline with full dark-theme styling,
 * typography, tables, and formula rendering.
 */
export async function exportSessionToPdf(
  session: Session,
  messages: Message[],
  onStatusUpdate?: (status: string) => void
): Promise<void> {
  if (!session || messages.length === 0) {
    throw new Error("No conversation messages found to export.");
  }

  onStatusUpdate?.("Formatting sequential PDF layout…");

  const fullHtml = buildCompletePrintHtml(session, messages);

  // Create isolated invisible iframe
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.zIndex = "-999";
  iframe.style.visibility = "hidden";

  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document || iframe.contentDocument;
  if (!iframeDoc) {
    window.print();
    return;
  }

  iframeDoc.open();
  iframeDoc.write(fullHtml);
  iframeDoc.close();

  // Wait briefly for the iframe to load styles & render fonts
  await new Promise((resolve) => setTimeout(resolve, 350));

  onStatusUpdate?.("Opening PDF save dialog…");

  try {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    onStatusUpdate?.("PDF ready!");
  } catch (err) {
    console.warn("Iframe print invocation failed, falling back to window.print():", err);
    window.print();
  } finally {
    // Keep iframe alive long enough for print preview to render, then clean up
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 5000);
  }
}
